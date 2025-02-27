import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import pLimit from 'p-limit';
import { Parser } from 'json2csv';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@neatflow/fileops', 'file.export');

type AxiosResponse = {
  data: Readable;
  headers: Record<string, string>;
};

type CSVError = {
  status: string;
  statusText: string;
  url: string;
  id?: string;
  message: string;
  details: string;
};

export type FileExportResult = {
  successCount: number;
  failureCount: number;
  errorLogPath?: string;
};

export default class FileExport extends SfCommand<FileExportResult> {
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
    'output-dir': Flags.directory({
      summary: messages.getMessage('flags.output-dir.summary'),
      description: messages.getMessage('flags.output-dir.description'),
      required: true,
      char: 'd',
    }),
    concurrency: Flags.integer({
      summary: messages.getMessage('flags.concurrency.summary'),
      description: messages.getMessage('flags.concurrency.description'),
      char: 'c',
      default: 3,
      min: 1,
      max: 10,
    }),
    id: Flags.string({
      summary: messages.getMessage('flags.id.summary'),
      char: 'i',
      default: 'Id',
    }),
    'ext-col-name': Flags.string({
      summary: messages.getMessage('flags.ext-col-name.summary'),
      description: messages.getMessage('flags.ext-col-name.description'),
      char: 'e',
    }),
    'target-org': Flags.requiredOrg(),
    'error-log': Flags.string({
      summary: 'Path to error log file',
      description: 'Specify a custom path for the error log file',
      default: 'file-export-errors.log',
    }),
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private idFieldName!: string;
  private extColName!: string;
  private errorLog: CSVError[] = [];
  private errorLogPath!: string;

  private static ensureOutputDirectory(outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  private static safeStringify(obj: unknown): string {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Readable) return '[Stream]';

      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) return `[Circular](${key})`;
        cache.add(value);
      }
      return value as unknown;
    });
  }

  public async run(): Promise<FileExportResult> {
    const { flags } = await this.parse(FileExport);
    const csvFilePath = flags.file;
    this.targetOrg = flags['target-org'];
    this.idFieldName = flags.id;
    this.extColName = flags['ext-col-name'] ?? '';
    this.errorLogPath = path.resolve(flags['error-log']);

    const concurrency = flags.concurrency;
    const outputDir: string = flags['output-dir'];
    const limit = pLimit(concurrency);
    const tasks: Array<Promise<boolean>> = [];

    FileExport.ensureOutputDirectory(outputDir);
    await this.targetOrg.refreshAuth();

    this.log(`Starting file export with concurrency: ${concurrency}`);
    this.log(`Reading CSV file: ${csvFilePath}`);
    this.log(`Output directory: ${outputDir}`);

    const thePromise: Promise<FileExportResult> = new Promise((resolve, reject) => {
      let totalFiles = 0;
      let downloadCount = 0;
      let successCount = 0;
      let failureCount = 0;

      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          totalFiles++;
          tasks.push(
            limit(async () => {
              try {
                await this.processRow(row, outputDir);
                successCount++;
                return true;
              } catch (error) {
                failureCount++;
                this.logError(
                  `Error processing row with ID ${row[this.idFieldName] || 'unknown'}`,
                  row[this.idFieldName],
                  error
                );
                return false;
              } finally {
                this.progress.update(++downloadCount);
              }
            })
          );
        })
        .on('end', () => {
          if (totalFiles === 0) {
            this.log('No records found in CSV file.');
            resolve({ successCount: 0, failureCount: 0 });
            return;
          }

          this.progress.start(0, {}, { title: 'Exporting files' });
          this.progress.setTotal(totalFiles);

          Promise.allSettled(tasks)
            .then(() => {
              this.progress.finish();
              this.writeFailuresToCsv();

              this.log(`Export complete. ${successCount} files exported successfully, ${failureCount} files failed.`);

              return {
                successCount,
                failureCount,
                errorLogPath: failureCount > 0 ? this.errorLogPath : undefined,
              } as FileExportResult;
            })
            .then((resp) => resolve(resp))
            .catch((err) => {
              this.progress.finish();
              this.logError('Fatal error during export process', '', err);
              this.writeFailuresToCsv();
              reject(err);
            });
        })
        .on('error', (err) => {
          this.progress.finish();
          this.logError('Error reading CSV file', '', err);
          this.writeFailuresToCsv();
          reject(err);
        });
    });

    return thePromise;
  }

  private logError(message: string, id: string, details?: unknown): void {
    const errorMessage: CSVError = {
      id,
      message,
      status: 'unknown',
      statusText: 'unknown',
      url: 'unknown',
      details: 'unknown',
    };

    if (details) {
      if (axios.isAxiosError(details)) {
        errorMessage.status = details.response?.status + '' ?? 'unknown';
        errorMessage.statusText = details.response?.statusText ?? 'unknown';
        errorMessage.url = details.config?.url ?? 'unknown';
      } else if (details instanceof Error) {
        errorMessage.details = details.message;
      } else {
        errorMessage.details = FileExport.safeStringify(details);
      }
    }

    this.errorLog.push(errorMessage);
    this.debug(errorMessage);
  }

  private writeFailuresToCsv(): void {
    if (this.errorLog.length > 0) {
      const fileName = 'errors' + Date.now() + '.csv';
      try {
        const parser = new Parser();
        const csv = parser.parse(this.errorLog);
        fs.writeFileSync(fileName, csv);
        this.log(`Errors written to ${fileName}`);
      } catch (err) {
        this.error(`Failed to write error log: ${(err as Error).message}`);
      }
    }
  }

  private async processRow(row: Record<string, string>, outputDir: string): Promise<void> {
    const contentVersionId = row[this.idFieldName];

    if (!contentVersionId) {
      throw new Error(`Missing ContentVersion ID in row: ${JSON.stringify(row)}`);
    }

    let ext = this.extColName ? row[this.extColName] : '';
    if (ext && ext.includes('.')) {
      ext = ext.split('.').pop() as string;
    }

    const conn = this.targetOrg.getConnection();
    const apiVersion = conn.getApiVersion();
    const fileUrl = `${conn.instanceUrl}/services/data/v${apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;

    let response: AxiosResponse | undefined;
    let writer: fs.WriteStream | undefined;

    try {
      response = await axios.get(fileUrl, {
        headers: { Authorization: `Bearer ${conn.accessToken}` },
        responseType: 'stream',
        timeout: 30000, // 30 second timeout
      });

      const fileName = ext ? `${contentVersionId}.${ext}` : contentVersionId;
      const outputFilePath = path.join(outputDir, `${fileName}`);
      writer = fs.createWriteStream(outputFilePath);

      await new Promise<void>((resolve, reject) => {
        if (!response || !writer) {
          reject(new Error('Response or writer not initialized'));
          return;
        }

        writer.on('finish', resolve);
        writer.on('error', reject);

        response.data.on('error', (err) => {
          reject(new Error(`Stream error: ${err.message}`));
        });

        response.data.pipe(writer);
      });
    } catch (err) {
      // Clean up resources in case of error
      if (axios.isAxiosError(err)) {
        (err?.response?.data as Readable).destroy();
      }
      if (writer) {
        writer.end();
      }
      throw err;
    }
  }
}
