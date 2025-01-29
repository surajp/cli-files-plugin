import fs from 'node:fs/promises';
import efs from 'node:fs';
import path from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('file-export', 'file.import');

type Result = {
  success: boolean;
  id: string;
  errors: string[];
};

type AxiosResponse = {
  data: Result[];
  headers: Record<string, string>;
};

type CSVRow = {
  VersionData: string;
  Title: string;
  PathOnClient: string;
} & Record<string, string>;

type UploadResult = {
  success: boolean;
  title?: string;
  error?: string;
};

export type FileImportResult = {
  total: number;
  success: number;
  failures: UploadResult[];
};

type ContentVersionRequest = {
  attributes: {
    type: 'ContentVersion';
    binaryPartName: string;
    binaryPartNameAlias: string;
  };
  Title: string;
  PathOnClient: string;
};

export default class FileImport extends SfCommand<FileImportResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    file: Flags.file({
      summary: messages.getMessage('flags.file.summary'),
      description: messages.getMessage('flags.file.description'),
      char: 'f',
      required: true,
      exists: true,
    }),
    'batch-size': Flags.integer({
      summary: 'Maximum batch size in MB',
      char: 'b',
      default: 30,
    }),
    concurrency: Flags.integer({
      summary: 'Number of parallel batches',
      char: 'c',
      default: 3,
    }),
    'target-org': Flags.requiredOrg(),
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private totalProcessed: number = 0;

  private static async createBatches(rows: CSVRow[], maxBatchSize: number): Promise<CSVRow[][]> {
    const batches: CSVRow[][] = [];
    let currentBatch: CSVRow[] = [];
    let currentBatchSize = 0;

    await Promise.all(
      rows.map(async (row) => {
        try {
          const fileStats = await fs.stat(row.VersionData);
          const fileSize = fileStats.size;

          if (fileSize + currentBatchSize > maxBatchSize) {
            batches.push(currentBatch);
            currentBatch = [];
            currentBatchSize = 0;
          }

          currentBatch.push(row);
          currentBatchSize += fileSize;
        } catch (error) {
          throw new Error(`Error processing file ${row.VersionData}: ${(error as Error).message}`);
        }
      })
    );

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    return batches;
  }

  public async run(): Promise<FileImportResult> {
    const { flags } = await this.parse(FileImport);
    this.targetOrg = flags['target-org'];
    const batchSizeBytes = flags['batch-size'] * 1024 * 1024;
    const concurrencyLimit = pLimit(flags.concurrency);

    const csvFilePath = flags.file;

    try {
      const rows: CSVRow[] = [];

      // First collect all rows synchronously
      await new Promise<void>((resolve, reject) => {
        efs
          .createReadStream(csvFilePath)
          .pipe(csvParser())
          .on('data', (row: CSVRow) => rows.push(row))
          .on('end', () => resolve())
          .on('error', reject);
      });

      const batches = await FileImport.createBatches(rows, batchSizeBytes);
      this.progress.start(0, {}, { title: 'Uploading {percentage}% | {value}/{total} files' });
      this.progress.setTotal(rows.length);

      const uploadTasks = batches.map((batch) => concurrencyLimit(() => this.processBatch(batch)));

      const batchResults = await Promise.all(uploadTasks);
      const finalResult = batchResults.reduce((acc, curr) => ({
        total: acc.total + curr.total,
        success: acc.success + curr.success,
        failures: [...acc.failures, ...curr.failures],
      }));

      this.progress.finish();
      this.log('File import completed');
      this.log(
        `Total: ${finalResult.total}, Success: ${finalResult.success}, Failures: ${finalResult.failures.length}`
      );
      if (finalResult.failures.length > 0) {
        this.log(JSON.stringify(finalResult.failures, null, 2));
      }
      return finalResult;
    } catch (error) {
      this.progress.finish();
      throw error;
    }
  }

  private async processBatch(batch: CSVRow[]): Promise<FileImportResult> {
    const results: UploadResult[] = [];
    const conn = this.targetOrg.getConnection();
    const formData = new FormData();
    const apiVersion = conn.getApiVersion();

    const records: ContentVersionRequest[] = [];
    const binaryParts = await Promise.all(
      batch.map(async (row) => {
        const partName = uuidv4();
        const filePath = row.VersionData;

        records.push({
          attributes: {
            type: 'ContentVersion',
            binaryPartName: partName,
            binaryPartNameAlias: 'VersionData',
          },
          Title: row.Title,
          PathOnClient: row.PathOnClient,
        });

        return {
          partName,
          filePath,
          size: (await fs.stat(filePath)).size,
        };
      })
    );

    try {
      formData.append('collection', JSON.stringify({ allOrNone: false, records }), { contentType: 'application/json' });

      // Add files to form data
      await Promise.all(
        binaryParts.map(({ partName, filePath, size }) => {
          formData.append(partName, efs.createReadStream(filePath), {
            filename: path.basename(filePath),
            knownLength: size,
          });
        })
      );

      const response: AxiosResponse = await axios.post(
        `${conn.instanceUrl}/services/data/v${apiVersion}/composite/sobjects`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${conn.accessToken}`,
          },
          maxBodyLength: 50 * 1024 * 1024, // 50MB
          maxContentLength: 50 * 1024 * 1024,
        }
      );

      // Process results
      response.data.forEach((result, index) => {
        if (result.success) {
          results.push({ success: true, title: batch[index].Title });
        } else {
          results.push({
            success: false,
            title: batch[index].Title,
            error: result.errors.join(', '),
          });
        }
        this.progress.update(this.totalProcessed++);
      });
    } catch (error) {
      // Mark entire batch as failed
      batch.forEach((row) => {
        results.push({
          success: false,
          title: row.Title,
          error: (error as Error).message,
        });
        this.progress.update(this.totalProcessed++);
      });
    }

    return {
      total: batch.length,
      success: results.filter((r) => r.success).length,
      failures: results.filter((r) => !r.success),
    };
  }
}
