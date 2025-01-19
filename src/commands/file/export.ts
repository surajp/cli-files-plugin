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

type CSVRow = {
  Id: string;
};

type AxiosResponse = {
  data: Readable;
};

type CustomError = {
  message: string;
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
    FileExport.ensureOutputDirectory(outputDir);

    const limit = pLimit(concurrency);

    const tasks: Array<Promise<void>> = [];
    fs.createReadStream(csvFilePath)
      .pipe(csvParser())
      .on('data', (row: CSVRow) => {
        tasks.push(limit(() => this.processRow(row, outputDir)));
      })
      .on('end', () => {
        Promise.all(tasks)
          .then(() => {
            this.log('File export completed.');
          })
          .catch((err: CustomError) => {
            this.error(`Failed to process some ContentVersion IDs: ${err.message}`);
          });
      })
      .on('error', (err) => {
        this.error(`Failed to read CSV file: ${err.message}`);
      });

    return { message: 'File export started.' };
  }

  private async processRow(row: CSVRow, outputDir: string): Promise<void> {
    try {
      const contentVersionId = row.Id;
      const conn = this.targetOrg.getConnection(this.apiVersion);
      if (!this.apiVersion) {
        this.apiVersion = conn.getApiVersion();
      }
      const fileUrl = `${conn.instanceUrl}/services/data/v${this.apiVersion}/sobjects/ContentVersion/${contentVersionId}/VersionData`;

      const response: AxiosResponse = await axios.get(fileUrl, {
        headers: { Authorization: `Bearer ${conn.accessToken}` },
        responseType: 'stream',
      });

      const outputFilePath = path.join(outputDir, `${contentVersionId}`);
      const writer: fs.WriteStream = fs.createWriteStream(outputFilePath);

      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      this.log(`Downloaded: ${outputFilePath}`);
    } catch (error) {
      this.error(`Failed to process ContentVersion ID ${row.Id}: ${(error as Error).message}`);
    }
  }
}
