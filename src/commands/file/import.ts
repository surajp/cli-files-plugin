import fs from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import FormData from 'form-data';
import pLimit from 'p-limit';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('file-export', 'file.export');

type CSVRow = {
  VersionData: string;
  Title: string;
} & Record<string, string>;

export type FileImportResult = {
  message: string;
};

export default class FileImport extends SfCommand<FileImportResult> {
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

  public async run(): Promise<FileImportResult> {
    const { flags } = await this.parse(FileImport);
    const csvFilePath = flags.file;
    this.targetOrg = flags['target-org'];
    if (flags['api-version']) {
      this.apiVersion = flags['api-version'];
    }
    const concurrency = flags.concurrency;

    const limit = pLimit(concurrency);

    const tasks: Array<Promise<void>> = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: CSVRow) => {
          this.log('Processing first row:', row);
          tasks.push(limit(() => this.processRow(row)));
        })
        .on('end', () => {
          Promise.all(tasks)
            .then(() => {
              this.log('File export completed.');
              resolve({ message: 'File export completed.' } as FileImportResult);
            })
            .catch((err: Error) => {
              this.error(`Failed to process some ContentVersion IDs: ${err.message}`);
              reject(err as FileImportResult);
            });
        })
        .on('error', (err) => {
          this.error(`Failed to read CSV file: ${err.message}`);
          reject(err);
        });
    });
  }

  private async processRow(row: CSVRow): Promise<void> {
    let fileUrl = '';
    try {
      this.log('Processing row:', row);
      const conn = this.targetOrg.getConnection(this.apiVersion);
      if (!this.apiVersion) {
        this.apiVersion = conn.getApiVersion();
      }
      fileUrl = `${conn.instanceUrl}/services/data/v${this.apiVersion}/sobjects/ContentVersion`;

      const formData = new FormData();
      const { VersionData, ...rest } = row;
      formData.append('entity_content', JSON.stringify(rest), { contentType: 'application/json' });
      formData.append('VersionData', fs.createReadStream(VersionData));

      await axios.post(fileUrl, formData, {
        headers: { ...formData.getHeaders(), Authorization: `Bearer ${conn.accessToken}` },
      });

      this.log(`Uploaded: ${row.Title}`);
    } catch (error) {
      this.error(`Failed to process ContentVersion ${row.Title}: ${(error as Error).message}`);
    }
  }
}
