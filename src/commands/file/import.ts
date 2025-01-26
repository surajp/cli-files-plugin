import fs from 'node:fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org } from '@salesforce/core';
import csvParser from 'csv-parser';
import axios from 'axios';
import FormData from 'form-data';
// import pLimit from 'p-limit';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('file-export', 'file.import');

type CSVRow = {
  VersionData: string;
  Title: string;
} & Record<string, string>;

export type FileImportResult = {
  message: string;
  success?: boolean;
};

type AxiosResponse = {
  data: string;
  headers: Record<string, string>;
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
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
  };

  protected static requiresUsername = true;
  private targetOrg!: Org;
  private apiVersion!: string;
  private rows: CSVRow[] = [];

  public async run(): Promise<FileImportResult> {
    const { flags } = await this.parse(FileImport);
    const csvFilePath: string = flags.file;
    this.targetOrg = flags['target-org'];
    if (flags['api-version']) {
      this.apiVersion = flags['api-version'];
    }
    // const concurrency = flags.concurrency;

    // const limit = pLimit(concurrency);

    let totalSize = 0;
    let grandTotalSize = 0;

    const tasks: Array<Promise<FileImportResult>> = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: CSVRow) => {
          this.log('Processing row:', row.Title);
          this.rows.push(row);
          const fileSize = fs.statSync(row.VersionData).size;
          totalSize += fileSize;
          grandTotalSize += fileSize;
          if (totalSize > 30000000) {
            tasks.push(this.processRows(this.rows));
            this.rows = [];
            totalSize = 0;
          }
        })
        .on('end', () => {
          if (this.rows.length > 0) {
            tasks.push(this.processRows(this.rows));
          }
          Promise.all(tasks)
            .then(() => {
              this.log('File import completed. total size:', grandTotalSize);
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

  private async processRows(rows: CSVRow[]): Promise<FileImportResult> {
    let fileUrl = '';
    try {
      const conn = this.targetOrg.getConnection(this.apiVersion);

      if (!this.apiVersion) {
        this.apiVersion = conn.getApiVersion();
      }
      fileUrl = `${conn.instanceUrl}/services/data/v${this.apiVersion}/composite/sobjects`;

      const records = [];
      const binaryData = [];
      for (const row of this.rows) {
        const { VersionData, ...rest } = row;
        const partName = 'FileData' + Math.random().toString(36).substring(7);
        const attr = { type: 'ContentVersion', binaryPartName: partName, binaryPartNameAlias: 'VersionData' };
        records.push({ attributes: attr, ...rest });
        binaryData.push({ partName, VersionData, title: row.Title });
      }
      const formData = new FormData();
      formData.append('collection', JSON.stringify({ allOrNone: false, records }), { contentType: 'application/json' });
      for (const data of binaryData) {
        formData.append(data.partName, fs.createReadStream(data.VersionData), data.title);
      }
      const response: AxiosResponse = await axios.post(fileUrl, formData, {
        headers: { ...formData.getHeaders(), Authorization: `Bearer ${conn.accessToken}` },
        responseType: 'json',
      });

      this.log(`Response: ${JSON.stringify(response.data)}`);
      this.log(`Uploaded: ${rows.length} files`);
      this.log('File import completed.');
      return { message: 'File import completed.', success: true } as FileImportResult;
    } catch (err) {
      this.log('Failed to process chunk', err);
      return { message: 'Failed to process chunk', success: false } as FileImportResult;
    }
  }
}
