import fs from 'node:fs/promises';
import efs from 'node:fs';
import path from 'node:path';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import { Parser } from 'json2csv';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@neatflow/fileops', 'file.import');
const MAX_SUBREQUESTS = 190; // composite api can have max 200 subrequests. We reduce it by 10 to be safe

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

type CompositeError = {
  message: string;
  statusCode: string;
  fields: string[];
};

type UploadResult = {
  success: boolean;
  title: string;
  versionData: string;
  error?: string;
  statusText?: string;
  fields?: string;
};

export type FileImportResult = {
  total: number;
  success: number;
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
      summary: messages.getMessage('flags.batch-size.summary'),
      description: messages.getMessage('flags.batch-size.description'),
      char: 'b',
      default: 30,
      max: 40,
      min: 1,
    }),
    concurrency: Flags.integer({
      summary: 'Number of parallel batches',
      char: 'c',
      default: 3,
      max: 12,
      min: 1,
    }),
    'target-org': Flags.requiredOrg(),
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private totalProcessed: number = 0;
  private errLog: UploadResult[] = [];

  private static async createBatches(rows: CSVRow[], maxBatchSize: number): Promise<CSVRow[][]> {
    const batches: CSVRow[][] = [];
    let currentBatch: CSVRow[] = [];
    let currentBatchSize = 0;
    let currentBatchFiles = 0;

    await Promise.all(
      rows.map(async (row) => {
        try {
          const fileStats = await fs.stat(row.VersionData);
          const fileSize = fileStats.size;

          if (fileSize + currentBatchSize > maxBatchSize || currentBatchFiles >= MAX_SUBREQUESTS) {
            // one composite request can have max 200 subrequests
            batches.push(currentBatch);
            currentBatch = [];
            currentBatchSize = 0;
            currentBatchFiles = 0;
          }

          currentBatch.push(row);
          currentBatchSize += fileSize;
          currentBatchFiles++;
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

  private static getContentTypeFromFileName(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.pdf':
        return 'application/pdf';
      case '.txt':
        return 'text/plain';
      case '.csv':
        return 'text/csv';
      case '.zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
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

      await this.targetOrg.refreshAuth();

      const uploadTasks = batches.map((batch) => concurrencyLimit(() => this.processBatch(batch)));

      const batchResults = await Promise.all(uploadTasks);
      const finalResult = batchResults.reduce((acc, curr) => ({
        total: acc.total + curr.total,
        success: acc.success + curr.success,
      }));

      this.progress.finish();
      this.log('File import completed');
      this.log(`Total: ${finalResult.total}, Success: ${finalResult.success}, Failures: ${this.errLog.length}`);
      await this.writeFailuresToCsv();
      return finalResult;
    } catch (error) {
      this.progress.finish();
      throw error;
    }
  }

  private async writeFailuresToCsv(): Promise<void> {
    if (this.errLog.length === 0) {
      return;
    }
    this.debug(JSON.stringify(this.errLog, null, 2));
    const fileName = 'errors' + Date.now() + '.csv';
    const parser = new Parser();
    const csv = parser.parse(this.errLog);
    await fs.writeFile(fileName, csv);
    this.log(`Errors written to ${fileName}`);
  }

  private async processBatch(batch: CSVRow[]): Promise<FileImportResult> {
    const results: UploadResult[] = [];
    const conn = this.targetOrg.getConnection();
    const formData = new FormData();
    const apiVersion = conn.getApiVersion();

    const records: ContentVersionRequest[] = [];
    const binaryParts = batch.map((row) => {
      const partName = uuidv4();
      const { VersionData, Title, PathOnClient, ...theRest } = row;
      const otherProps: Record<string, string | object> = {};
      for (const [key, value] of Object.entries(theRest)) {
        if (!key.includes('.')) {
          otherProps[key] = value;
          continue;
        }

        const [fieldNamePart, parentFieldName] = key.split('.');
        const [fieldName, parentObject] = fieldNamePart.includes(':')
          ? fieldNamePart.split(':')
          : [fieldNamePart, null];

        if (parentObject) {
          otherProps[fieldName] = { attributes: { type: parentObject }, [parentFieldName]: value };
        } else {
          otherProps[fieldName] = {
            [parentFieldName]: value,
          };
        }
      }

      records.push({
        attributes: {
          type: 'ContentVersion',
          binaryPartName: partName,
          binaryPartNameAlias: 'VersionData',
        },
        Title,
        PathOnClient,
        ...otherProps,
      });

      return {
        partName,
        versionData: VersionData,
        filePath: PathOnClient,
        contentType: FileImport.getContentTypeFromFileName(PathOnClient),
      };
    });

    try {
      formData.append('collection', JSON.stringify({ allOrNone: false, records }), { contentType: 'application/json' });

      // Add files to form data
      await Promise.all(
        binaryParts.map(({ partName, versionData, filePath, contentType }) => {
          formData.append(partName, efs.createReadStream(versionData), {
            filename: path.basename(filePath),
            contentType,
          });
        })
      );

      const response: AxiosResponse = await axios.post(
        `${conn.instanceUrl}/services/data/v${apiVersion}/composite/sobjects`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${conn.accessToken ?? ''}`,
          },
        }
      );

      // Process results
      response.data.forEach((result, index) => {
        if (result.success) {
          results.push({ success: true, title: batch[index].Title, versionData: batch[index].VersionData });
        } else {
          const compErr = result.errors[0] as unknown as CompositeError;
          this.errLog.push({
            success: false,
            title: batch[index].Title,
            versionData: batch[index].VersionData,
            error: compErr.message,
            statusText: compErr.statusCode,
            fields: compErr.fields.join('|'),
          });
        }
        this.progress.update(this.totalProcessed++);
      });
    } catch (error) {
      batch.forEach((row) => {
        const axErr: AxiosError = error as AxiosError;
        this.errLog.push({
          success: false,
          title: row.Title,
          versionData: row.VersionData,
          error: axErr.message,
          statusText: axErr.response?.statusText,
        });
        this.progress.update(this.totalProcessed++);
      });
    }

    return {
      total: batch.length,
      success: results.filter((r) => r.success).length,
    };
  }
}
