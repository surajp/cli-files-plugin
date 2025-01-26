import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import pLimit from 'p-limit';
import { SingleBar, Presets } from 'cli-progress';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('file-export', 'file.export');

type CSVRow = {
  Id: string;
};

type AxiosResponse = {
  data: Readable;
  headers: Record<string, string>;
};

export type FileExportResult = {
  message: string;
};

export default class FileExport extends SfCommand<FileExportResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    file: Flags.string({
      summary: messages.getMessage('flags.file.summary'),
      description: messages.getMessage('flags.file.description'),
      char: 'f',
      required: true,
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
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private apiVersion!: string;

  private static ensureOutputDirectory(outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  public async run(): Promise<FileExportResult> {
    const { flags } = await this.parse(FileExport);
    const csvFilePath = flags.file;
    this.targetOrg = flags['target-org'];
    if (flags['api-version']) {
      this.apiVersion = flags['api-version'];
    }

    const concurrency = flags.concurrency;
    const outputDir = flags['output-dir'];
    const limit = pLimit(concurrency);
    const tasks: Array<Promise<void>> = [];

    FileExport.ensureOutputDirectory(outputDir);

    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: CSVRow) => {
          tasks.push(limit(() => this.processRow(row, outputDir)));
        })
        .on('end', () => {
          Promise.all(tasks)
            .then(() => {
              this.log('File export completed.');
              resolve({ message: 'File export completed.' } as FileExportResult);
            })
            .catch((err: Error) => {
              reject(err as FileExportResult);
              this.error(`Failed to process some ContentVersion IDs: ${err.message}`);
            });
        })
        .on('error', (err) => {
          reject(err);
          this.error(`Failed to read CSV file: ${err.message}`);
        });
    });
  }

  private async processRow(row: CSVRow, outputDir: string): Promise<void> {
    let fileUrl = '';
    try {
      this.log('Processing row:', row);
      const contentVersionId = row.Id;
      const conn = this.targetOrg.getConnection(this.apiVersion);
      if (!this.apiVersion) {
        this.apiVersion = conn.getApiVersion();
      }
      fileUrl = `${conn.instanceUrl}/services/data/v${this.apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;

      const response: AxiosResponse = await axios.get(fileUrl, {
        headers: { Authorization: `Bearer ${conn.accessToken}` },
        responseType: 'stream',
      });

      const outputFilePath = path.join(outputDir, `${contentVersionId}`);
      const writer: fs.WriteStream = fs.createWriteStream(outputFilePath);
      const totalLength = parseInt(response.headers['content-length'], 10);

      if (totalLength && isNaN(totalLength)) {
        this.log(
          'Skipping download of ContentVersion ID',
          contentVersionId,
          'because content-length is invalid',
          totalLength
        );
        return;
      }

      const progressBar = new SingleBar(
        {
          format: 'Downloading {bar} {percentage}% | ETA: {eta}s | {value}/{total} bytes',
          hideCursor: true,
        },
        Presets.shades_classic
      );

      progressBar.start(totalLength, 0);

      response.data.on('data', (chunk: Buffer) => {
        progressBar.increment(chunk.length);
      });

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => {
          resolve();
          this.log(`Downloaded: ${outputFilePath}`);
          progressBar.stop();
        });
        writer.on('error', reject);
        response.data.pipe(writer);
      });
    } catch (error) {
      this.error(`Failed to process ContentVersion ID ${row.Id}: ${(error as Error).message}: ${fileUrl}`);
    }
  }
}
