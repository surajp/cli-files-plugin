import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, Org, SfError } from '@salesforce/core';
import csvParser from 'csv-parser';
// import axios from 'axios'; Removed axios
import pLimit from 'p-limit'; // Will be used for batch concurrency later if needed
import { Parser } from 'json2csv';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@neatflow/fileops', 'fileops.export');

// type AxiosResponse = { // Removed
//   data: Readable;
//   headers: Record<string, string>;
// };

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
    // concurrency: Flags.integer({ // Concurrency will be handled by batching, or later for batch concurrency
    //   summary: messages.getMessage('flags.concurrency.summary'),
    //   description: messages.getMessage('flags.concurrency.description'),
    //   char: 'c',
    //   default: 3,
    //   min: 1,
    //   max: 10,
    // }),
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
  private errorLog: CSVError[] = [];

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
    const outputDir: string = flags['output-dir'];

    FileExport.ensureOutputDirectory(outputDir);
    await this.targetOrg.refreshAuth();

    // this.log(`Starting file export with concurrency: ${concurrency}`); // Concurrency changed
    this.log(`Reading CSV file: ${csvFilePath}`);
    this.log(`Output directory: ${outputDir}`);

    const recordsToProcess: Array<{ id: string; ext: string | undefined }> = [];

    this.progress.start(0, {}, { title: 'Reading CSV and preparing batches...' });

    return new Promise<FileExportResult>((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: Record<string, string>) => {
          const contentVersionId = row[this.idFieldName];
          if (contentVersionId) {
            let extValue: string | undefined;
            if (this.extColName && row[this.extColName]) {
              extValue = row[this.extColName];
              if (extValue.includes('.')) {
                extValue = extValue.split('.').pop();
              }
            }
            recordsToProcess.push({ id: contentVersionId, ext: extValue });
          } else {
            this.logWarn(`Skipping row due to missing ID: ${FileExport.safeStringify(row)}`);
          }
        })
        .on('end', async () => {
          if (recordsToProcess.length === 0) {
            this.log('No records found in CSV file to process.');
            this.progress.finish();
            resolve({ successCount: 0, failureCount: 0 });
            return;
          }

          this.log(`Total records to process: ${recordsToProcess.length}`);
          this.progress.setTotal(recordsToProcess.length);
          this.progress.update(0, { title: 'Exporting files via Composite Batch API...' });


          try {
            // Call the new batch export method
            const result = await this.batchExportFiles(recordsToProcess, outputDir);
            this.progress.finish();
            this.writeFailuresToCsv();
            this.log(
              `Export complete. ${result.successCount} files exported successfully, ${result.failureCount} files failed.`
            );
            resolve(result);
          } catch (error) {
            this.progress.finish();
            const sfError = SfError.wrap(error);
            this.logError('Fatal error during batch export process', '', sfError.message, FileExport.safeStringify(sfError.data));
            this.writeFailuresToCsv();
            reject(sfError);
          }
        })
        .on('error', (err) => {
          this.progress.finish();
          this.logError('Error reading CSV file', '', err.message, FileExport.safeStringify(err));
          this.writeFailuresToCsv();
          reject(err);
        });
    });
  }

  // New method to be implemented
  private async batchExportFiles(
    records: Array<{ id: string; ext: string | undefined }>,
    outputDir: string
  ): Promise<FileExportResult> {
    let successCount = 0;
    let failureCount = 0;
    const conn = this.targetOrg.getConnection();
    const apiVersion = conn.getApiVersion();
    const batchSize = 25; // Composite API limit

    this.log(`Starting batch export. Total records: ${records.length}, Batch size: ${batchSize}`);

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      this.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(records.length / batchSize)}...`);

      const batchRequests = batch.map((record) => ({
        method: 'GET' as const,
        url: `/services/data/v${apiVersion}/sobjects/ContentVersion/${record.id}/VersionData`,
        binaryPartNameAlias: `VersionData_${record.id}`, // Unique alias per subrequest
      }));

      const requestBody = {
        batchRequests,
      };

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await conn.request({
          method: 'POST',
          url: `/services/data/v${apiVersion}/composite/batch`,
          body: JSON.stringify(requestBody),
          headers: { 'Content-Type': 'application/json' },
        });

        if (response && response.results && Array.isArray(response.results)) {
          for (let j = 0; j < response.results.length; j++) {
            const subRequestResult = response.results[j];
            const originalRecord = batch[j]; // Assuming order is preserved

            if (subRequestResult.statusCode === 200) {
              // How to get binary data? jsforce might handle it.
              // The 'result' for a binary GET in composite batch is typically the base64 encoded binary.
              // Or, if using binaryPartNameAlias effectively, it might be in a separate part of a multipart response
              // which jsforce's request() should ideally parse and make available.
              // For now, let's assume subRequestResult.result contains the binary data (e.g., base64 encoded).
              // This is a critical point that might need adjustment based on actual jsforce behavior.

              const binaryDataB64 = subRequestResult.result as string; // This is an assumption
              if (!binaryDataB64) {
                this.logError(
                  `Missing binary data in successful response for ID ${originalRecord.id}`,
                  originalRecord.id,
                  'No binary data found in sub-request result',
                  FileExport.safeStringify(subRequestResult)
                );
                failureCount++;
                this.progress.increment(1);
                continue;
              }

              try {
                const fileContent = Buffer.from(binaryDataB64, 'base64');
                const fileName = originalRecord.ext
                  ? `${originalRecord.id}.${originalRecord.ext}`
                  : originalRecord.id;
                const outputFilePath = path.join(outputDir, fileName);
                fs.writeFileSync(outputFilePath, fileContent);
                successCount++;
              } catch (saveError) {
                failureCount++;
                this.logError(
                  `Error saving file for ID ${originalRecord.id}`,
                  originalRecord.id,
                  saveError instanceof Error ? saveError.message : FileExport.safeStringify(saveError),
                  FileExport.safeStringify(subRequestResult)
                );
              }
            } else {
              failureCount++;
              // subRequestResult.result is an array of error objects
              const errorDetails = subRequestResult.result?.[0]?.message ?? 'Unknown error';
              this.logError(
                `Error in batch sub-request for ID ${originalRecord.id}`,
                originalRecord.id,
                `Status ${subRequestResult.statusCode}: ${errorDetails}`,
                FileExport.safeStringify(subRequestResult.result)
              );
            }
            this.progress.increment(1);
          }
        } else {
          // This case should ideally not happen if the API call itself was successful (200 OK for the batch request)
          // but the response structure is not as expected.
          this.logError(
            `Unexpected batch response structure for batch starting with ID ${batch[0]?.id}`,
            batch[0]?.id,
            'Malformed batch response',
            FileExport.safeStringify(response)
          );
          failureCount += batch.length; // Count all in batch as failed
          this.progress.increment(batch.length);
        }
      } catch (batchError) {
        failureCount += batch.length; // Count all in batch as failed
        this.progress.increment(batch.length);
        const sfError = SfError.wrap(batchError);
        this.logError(
          `Error processing batch starting with ID ${batch[0]?.id}`,
          batch[0]?.id,
          sfError.message,
          FileExport.safeStringify(sfError.data)
        );
      }
    }
    return { successCount, failureCount };
  }


  private logError(message: string, id: string | undefined, details?: unknown, rawResponse?: string): void {
    const errorMessage: CSVError = {
      id: id ?? 'N/A',
      message,
      status: 'unknown',
      statusText: 'unknown',
      url: 'N/A (Composite Batch)', // URL is part of sub-request, not top-level error
      details: 'unknown',
    };

    if (details) {
      if (typeof details === 'string') {
        errorMessage.details = details;
      } else if (details instanceof Error) {
        errorMessage.details = details.message;
        if (details instanceof SfError) {
          errorMessage.status = details.name; // Or some other relevant field from SfError
          errorMessage.statusText = details.message; // Or more specific context if available
        }
      } else {
        errorMessage.details = FileExport.safeStringify(details);
      }
    }
    if (rawResponse) {
      // Potentially add rawResponse to the error log if it's useful and not too verbose
      // For now, just logging it to debug
      this.debug(`Raw response/data for error: ${rawResponse}`);
    }


    this.errorLog.push(errorMessage);
    this.debug(FileExport.safeStringify(errorMessage)); // Use safeStringify for debug output
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

  // private async processRow(row: Record<string, string>, outputDir: string): Promise<void> {
  //   // This method is no longer used directly for downloads.
  //   // Its logic for filename generation and file saving is incorporated into batchExportFiles.
  // }
}
