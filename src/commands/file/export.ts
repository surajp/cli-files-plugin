import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import pLimit from 'p-limit';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('file-export', 'file.export');

type AxiosResponse = {
  data: Readable;
  headers: Record<string, string>;
};

export type FileExportResult = {
  successCount: number;
  failureCount: number;
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
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private idFieldName!: string;
  private extColName!: string;

  private static ensureOutputDirectory(outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  public async run(): Promise<FileExportResult> {
    const { flags } = await this.parse(FileExport);
    const csvFilePath = flags.file;
    this.targetOrg = flags['target-org'];
    this.idFieldName = flags.id;
    this.extColName = flags['ext-col-name'] ?? '';

    const concurrency = flags.concurrency;
    const outputDir: string = flags['output-dir'];
    const limit = pLimit(concurrency);
    const tasks: Array<Promise<void>> = [];

    FileExport.ensureOutputDirectory(outputDir);

    const thePromise: Promise<FileExportResult> = new Promise((resolve, reject) => {
      let totalFiles = 0;
      let downloadCount = 0;
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          totalFiles++;
          tasks.push(
            limit(async () => {
              try {
                await this.processRow(row, outputDir);
              } catch (error) {
                this.error(`Error processing row: ${(error as Error).message}`);
              } finally {
                this.progress.update(++downloadCount);
              }
            })
          );
        })
        .on('end', () => {
          this.progress.start(0, {}, { title: 'Exporting files' });
          this.progress.setTotal(totalFiles);
          Promise.allSettled(tasks)
            .then((results) => {
              this.progress.finish();
              const successCount = results.filter((r) => r.status === 'fulfilled').length;
              const failureCount = results.filter((r) => r.status === 'rejected').length;
              this.log(`Export complete. ${successCount} files exported successfully, ${failureCount} files failed.`);
              return { successCount, failureCount } as FileExportResult;
            })
            .then((resp) => resolve(resp))
            .catch((err) => {
              this.progress.finish();
              reject(err);
            });
        })
        .on('error', (err) => {
          this.progress.finish();
          reject(err);
        });
    });

    const result: FileExportResult = await thePromise;
    return result;
  }

  private async processRow(row: Record<string, string>, outputDir: string): Promise<void> {
    const contentVersionId = row[this.idFieldName];

    try {
      let ext = this.extColName ? row[this.extColName] : '';
      if (ext && ext.includes('.')) {
        ext = ext.split('.').pop() as string;
      }

      if (!contentVersionId) {
        this.error('Missing ContentVersion ID');
      }

      const conn = this.targetOrg.getConnection();
      const apiVersion = conn.getApiVersion();
      const fileUrl = `${conn.instanceUrl}/services/data/v${apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;

      const response: AxiosResponse = await axios.get(fileUrl, {
        headers: { Authorization: `Bearer ${conn.accessToken}` },
        responseType: 'stream',
      });

      const fileName = ext ? `${contentVersionId}.${ext}` : contentVersionId;
      const outputFilePath = path.join(outputDir, `${fileName}`);
      const writer = fs.createWriteStream(outputFilePath);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.pipe(writer);
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        // we have to forcibly close the stream here or the process hangs if the download fails
        (err.response as AxiosResponse)?.data?.destroy();
      }
      throw err;
    }
  }
}
