import fs, { PathLike, Stats, WriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import { TestContext } from '@salesforce/core/testSetup';
import { Org, SfError } from '@salesforce/core';
import { expect } from 'chai';
import { stubSfCommandUx, stubSpinner, stubUx } from '@salesforce/sf-plugins-core';
import sinon, { SinonStub, SinonStubbedInstance } from 'sinon';
// import axios from 'axios'; // Removed
import FileExport from '../../../src/commands/fileops/export.js';

// describe('file export', () => {
//   const $$: TestContext = new TestContext();
//   let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
//   const csvData: string = 'Id\n12345\n67890';
//   let createReadStreamStub: SinonStub;
//   let writeStreamStub: SinonStub; // Remains for error CSV
//   // let axiosGetStub: SinonStub; // Removed

//   let mockConnection: any;
//   let writeFileSyncStub: SinonStub;
//   const writtenFiles = new Map<string, Buffer>(); // To capture data written by fs.writeFileSync for downloaded files

//   beforeEach(() => {
//     sfCommandStubs = stubSfCommandUx($$.SANDBOX);
//     stubSpinner($$.SANDBOX);
//     stubUx($$.SANDBOX);


//     // Mock fs.promises.stat for file existence checks
//     $$.SANDBOX.stub(fs.promises, 'stat').resolves({ size: 100, isFile: () => true } as Stats);
//     $$.SANDBOX.stub(fs, 'existsSync').returns(true); // Assume output dir exists or is created
//     $$.SANDBOX.stub(fs, 'mkdirSync');


//     // Stub for reading CSV
//     createReadStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').callsFake(() => {
//       const stream = new Readable({
//         read() {
//           this.push(Buffer.from(csvData));
//           this.push(null);
//         },
//       });
//       return stream as fs.ReadStream;
//     });

//     // Stub for fs.writeFileSync (used by the command to save downloaded files and error CSV)
//     writeFileSyncStub = $$.SANDBOX.stub(fs, 'writeFileSync').callsFake((filePath, data) => {
//       writtenFiles.set(filePath as string, Buffer.isBuffer(data) ? data : Buffer.from(data as string));
//     });


//     // Mock Connection and its request method
//     mockConnection = {
//       request: $$.SANDBOX.stub(),
//       getApiVersion: $$.SANDBOX.stub().returns('58.0'),
//       // Mock other connection properties if needed by the command during initialization
//       instanceUrl: 'https://example.salesforce.com',
//       accessToken: 'fakeAccessToken',
//     };

//     // Stub Org.prototype.getConnection to return our mock connection
//     // Typing shenanigans to satisfy the strict checks of the library for Org.prototype.getConnection
//     const getOrgStub = $$.SANDBOX.stub(Org.prototype, 'getConnection');
//     getOrgStub.returns(mockConnection as unknown as ReturnType<Org['getConnection']>);


//   });

//   afterEach(() => {
//     writtenFiles.clear();
//     $$.restore();
//   });

//   it('should ensure output directory exists', async () => {
//     const localMkdirSyncStub = sinon.stub(fs, 'mkdirSync');
//     const localExistsSyncStub = sinon.stub(fs, 'existsSync').returns(false);

//     FileExport['ensureOutputDirectory']('test-output-dir'); // Static method access
//     expect(localExistsSyncStub.calledOnceWith('test-output-dir')).to.be.true;
//     expect(localMkdirSyncStub.calledOnceWith('test-output-dir', { recursive: true })).to.be.true;
//     localMkdirSyncStub.restore();
//     localExistsSyncStub.restore();
//   });


//   it('should process a valid CSV file and download files', async () => {
//     const fileContent1 = 'content for 12345';
//     const fileContent2 = 'content for 67890';

//     mockConnection.request.resolves({
//       hasErrors: false,
//       results: [
//         { statusCode: 200, result: Buffer.from(fileContent1).toString('base64') },
//         { statusCode: 200, result: Buffer.from(fileContent2).toString('base64') },
//       ],
//     });

//     const flags = {
//       file: './mock.csv',
//       'output-dir': './output',
//       // concurrency: 1, // Removed
//       'target-org': 'mockOrg', // This will be used by $$.stubOrg() or similar if not using direct prototype stubbing
//     };

//     // Simulate target-org flag correctly for command context
//     $$.stubAliases({ mockOrg: 'test@org.com' });
//     const org = await Org.create({ aliasOrUsername: 'mockOrg' });
//     $$.SANDBOX.stub(Org, 'create').resolves(org); // Ensure FileExport gets a valid Org
//     // Re-stub getConnection on this specific org instance if necessary, or rely on prototype stub.
//     // For simplicity, prototype stub is often easier for unit tests.

//     await FileExport.run([
//       '--file', flags.file,
//       '--output-dir', flags['output-dir'],
//       '--target-org', flags['target-org'], // Command framework will handle Org creation
//     ]);

//     expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
//     expect(mockConnection.request.calledOnce).to.be.true;

//     const requestArg = mockConnection.request.getCall(0).args[0];
//     expect(requestArg.method).to.equal('POST');
//     expect(requestArg.url).to.include('/composite/batch');
//     const requestBody = JSON.parse(requestArg.body);
//     expect(requestBody.batchRequests).to.have.lengthOf(2);
//     expect(requestBody.batchRequests[0].url).to.include('/sobjects/ContentVersion/12345/VersionData');
//     expect(requestBody.batchRequests[1].url).to.include('/sobjects/ContentVersion/67890/VersionData');


//     expect(writeFileSyncStub.callCount).to.equal(2);
//     const expectedPath1 = path.join(flags['output-dir'], '12345');
//     const expectedPath2 = path.join(flags['output-dir'], '67890');

//     expect(writtenFiles.get(expectedPath1)?.toString()).to.equal(fileContent1);
//     expect(writtenFiles.get(expectedPath2)?.toString()).to.equal(fileContent2);

//     const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
//     expect(logs).to.include('Export complete. 2 files exported successfully, 0 files failed.');
//   });

//   // Remaining tests to be refactored:
//   // - should handle errors during file processing
//   // - should fail when CSV file cannot be read (this one might be largely okay)
//   // - should log progress and completion message (check messages)
//   // - should handle alternate ID field name (check batch request URLs)

//   // New tests to be added:
//   // - Batching Logic (>25 records)
//   // - Mixed Success/Failure in a Batch
//   // - Empty CSV
//   // - CSV with only invalid IDs
// });

// A more robust way to define the test suite structure:
describe('file export', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  // Default CSV data, can be overridden in tests
  let currentCsvData = 'Id,Ext\n12345,txt\n67890,doc';
  const fileContentMap = new Map<string, string>([
    ['12345', 'File content for 12345'],
    ['67890', 'File content for 67890'],
    ['00001', 'File content for 00001'], // For custom ID tests
    ['00002', 'File content for 00002'],
  ]);


  let createReadStreamStub: SinonStub;
  let writeFileSyncStub: SinonStub;
  let mkdirSyncStub: SinonStub;
  let existsSyncStub: SinonStub;
  let statStub: SinonStub;

  let mockConnectionRequest: SinonStub;
  let mockOrg: SinonStubbedInstance<Org>;

  const writtenFiles = new Map<string, Buffer>();

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    stubSpinner($$.SANDBOX); // Needed for progress bar
    stubUx($$.SANDBOX);


    // Mock fs operations
    statStub = $$.SANDBOX.stub(fs.promises, 'stat').resolves({ size: 100, isFile: () => true } as Stats);
    createReadStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').callsFake(() => {
      const stream = new Readable({
        read() {
          this.push(Buffer.from(currentCsvData));
          this.push(null);
        },
      });
      return stream as fs.ReadStream;
    });

    writeFileSyncStub = $$.SANDBOX.stub(fs, 'writeFileSync').callsFake((filePath, data) => {
      writtenFiles.set(filePath as string, Buffer.isBuffer(data) ? data : Buffer.from(data as string));
    });
    mkdirSyncStub = $$.SANDBOX.stub(fs, 'mkdirSync');
    existsSyncStub = $$.SANDBOX.stub(fs, 'existsSync').returns(true); // Default to output dir existing


    // Setup mock Org and Connection
    mockConnectionRequest = $$.SANDBOX.stub();
    const mockConn = {
      request: mockConnectionRequest,
      getApiVersion: $$.SANDBOX.stub().returns('58.0'),
      instanceUrl: 'https://test.my.salesforce.com',
      accessToken: 'fakeToken',
    };

    // Create a stubbed Org instance
    mockOrg = $$.SANDBOX.createStubInstance(Org);
    // Type assertion needed as stubbed instance methods don't perfectly match original
    (mockOrg.getConnection as SinonStub).returns(mockConn as any);
    (mockOrg.getUsername as SinonStub).returns('test@example.com');


    // When FileExport asks for an Org, give it our stubbed one.
    // This ensures 'this.targetOrg' in the command is our mockOrg.
    $$.SANDBOX.stub(Org, 'create').resolves(mockOrg);
  });

  afterEach(() => {
    $$.restore();
    writtenFiles.clear();
    currentCsvData = 'Id,Ext\n12345,txt\n67890,doc'; // Reset CSV data
  });

  it('should ensure output directory exists if not present', async () => {
    existsSyncStub.returns(false); // Simulate directory does not exist
    // FileExport['ensureOutputDirectory'] is static, call it directly
    FileExport['ensureOutputDirectory']('test-output-dir');
    expect(existsSyncStub.calledOnceWith('test-output-dir')).to.be.true;
    expect(mkdirSyncStub.calledOnceWith('test-output-dir', { recursive: true })).to.be.true;
  });

  it('should process a valid CSV file and download files (default ID, with extension)', async () => {
    // Mock successful batch response
    mockConnectionRequest.resolves({
      hasErrors: false,
      results: [
        { statusCode: 200, result: Buffer.from(fileContentMap.get('12345')!).toString('base64') },
        { statusCode: 200, result: Buffer.from(fileContentMap.get('67890')!).toString('base64') },
      ],
    });

    await FileExport.run(['--file', 'mock.csv', '--output-dir', './output', '--target-org', 'testOrgAlias', '--ext-col-name', 'Ext']);

    expect(createReadStreamStub.calledOnceWith('mock.csv')).to.be.true;
    expect(mockConnectionRequest.calledOnce).to.be.true;

    const requestArg = mockConnectionRequest.getCall(0).args[0];
    expect(requestArg.method).to.equal('POST');
    expect(requestArg.url).to.equal('/services/data/v58.0/composite/batch');
    const requestBody = JSON.parse(requestArg.body);
    expect(requestBody.batchRequests).to.have.lengthOf(2);
    expect(requestBody.batchRequests[0].url).to.equal('/services/data/v58.0/sobjects/ContentVersion/12345/VersionData');
    expect(requestBody.batchRequests[0].binaryPartNameAlias).to.equal('VersionData_12345');
    expect(requestBody.batchRequests[1].url).to.equal('/services/data/v58.0/sobjects/ContentVersion/67890/VersionData');
    expect(requestBody.batchRequests[1].binaryPartNameAlias).to.equal('VersionData_67890');

    expect(writeFileSyncStub.callCount).to.equal(2);
    expect(writtenFiles.get(path.join('./output', '12345.txt'))?.toString()).to.equal(fileContentMap.get('12345'));
    expect(writtenFiles.get(path.join('./output', '67890.doc'))?.toString()).to.equal(fileContentMap.get('67890'));

    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include('Export complete. 2 files exported successfully, 0 files failed.');
  });


  it('should handle errors during file processing in a batch', async () => {
    currentCsvData = 'Id\n12345\n67890\n22222'; // 3 records
    mockConnectionRequest.resolves({
      hasErrors: true,
      results: [
        { statusCode: 200, result: Buffer.from(fileContentMap.get('12345')!).toString('base64') },
        { statusCode: 404, result: [{ errorCode: 'NOT_FOUND', message: 'ContentVersion 67890 not found' }] },
        { statusCode: 500, result: [{ errorCode: 'SERVER_ERROR', message: 'Server error for 22222' }] },
      ],
    });

    await FileExport.run(['--file', 'mock.csv', '--output-dir', './output', '--target-org', 'testOrgAlias']);

    expect(mockConnectionRequest.calledOnce).to.be.true;
    expect(writeFileSyncStub.callCount).to.equal(2); // 1 success, 1 error log

    // Check successful download
    expect(writtenFiles.get(path.join('./output', '12345'))?.toString()).to.equal(fileContentMap.get('12345'));

    // Check error log CSV
    const errorLogCall = writeFileSyncStub.getCalls().find(call => (call.args[0] as string).startsWith('errors'));
    expect(errorLogCall).to.not.be.undefined;
    const errorCsvContent = writtenFiles.get(errorLogCall!.args[0] as string)?.toString();
    expect(errorCsvContent).to.include('67890,"Error in batch sub-request for ID 67890"');
    expect(errorCsvContent).to.include('Status 404: ContentVersion 67890 not found');
    expect(errorCsvContent).to.include('22222,"Error in batch sub-request for ID 22222"');
    expect(errorCsvContent).to.include('Status 500: Server error for 22222');


    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include('Export complete. 1 files exported successfully, 2 files failed.');
  });

  it('should fail gracefully when CSV file cannot be read', async () => {
    createReadStreamStub.restore(); // Remove the default working stub
    const fileNotFoundError = new Error('ENOENT: no such file or directory');
    (fileNotFoundError as NodeJS.ErrnoException).code = 'ENOENT';
    createReadStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').throws(fileNotFoundError);

    try {
      await FileExport.run(['--file', 'nonexistent.csv', '--output-dir', './output', '--target-org', 'testOrgAlias']);
      expect.fail('Command should have thrown an error');
    } catch (error) {
      const sfErr = error as SfError;
      expect(sfErr.message).to.include('Error reading CSV file');
      // Check if the original error message is part of the details or context if SfError wraps it.
      // For this specific setup, the error is directly from the 'error' event of the stream.
      expect(sfErr.cause.message).to.equal('ENOENT: no such file or directory');
    }
    expect(createReadStreamStub.calledOnce).to.be.true;
    expect(mockConnectionRequest.called).to.be.false; // Should not attempt API call
  });


  it('should log progress and completion message', async () => {
    mockConnectionRequest.resolves({ // Mock a successful response for any call
      hasErrors: false,
      results: [ /* content doesn't matter for this test, just structure */
        { statusCode: 200, result: Buffer.from('data1').toString('base64') },
        { statusCode: 200, result: Buffer.from('data2').toString('base64') },
      ],
    });
    await FileExport.run(['--file', 'mock.csv', '--output-dir', './output', '--target-org', 'testOrgAlias']);

    const logOutput = sfCommandStubs.log.getCalls().map(call => call.args[0]).join('\n');
    const progressOutput = sfCommandStubs.progress.getCalls().map(call => call.args[0]?.message ?? call.args.join(' ')).join('\n');


    expect(logOutput).to.include('Reading CSV file: mock.csv');
    expect(logOutput).to.include('Output directory: ./output');
    expect(logOutput).to.include('Total records to process: 2');
    expect(logOutput).to.include('Processing batch 1 of 1...');
    expect(logOutput).to.include('Export complete. 2 files exported successfully, 0 files failed.');

    // Check spinner messages
    const spinnerStarts = sfCommandStubs.spinner.getCalls().filter(c => c.thisValue.start);
    const spinnerStops = sfCommandStubs.spinner.getCalls().filter(c => c.thisValue.stop);
    
    // Based on the new ux.progress structure
    // this.progress.start(0, {}, { title: 'Reading CSV and preparing batches...' });
    // this.progress.setTotal(recordsToProcess.length);
    // this.progress.update(0, { title: 'Exporting files via Composite Batch API...' });
    // this.progress.increment(1);
    // this.progress.finish();

    // Cannot directly inspect active spinner messages easily with stubSfCommandUx's spinner.
    // Log messages are a better proxy here.
  });

  it('should handle alternate ID field name and ignore default ID', async () => {
    currentCsvData = 'CustomId,Id,Ext\n00001,99999,txt\n00002,88888,doc'; // CustomId should be used

    mockConnectionRequest.resolves({
      hasErrors: false,
      results: [
        { statusCode: 200, result: Buffer.from(fileContentMap.get('00001')!).toString('base64') },
        { statusCode: 200, result: Buffer.from(fileContentMap.get('00002')!).toString('base64') },
      ],
    });

    await FileExport.run([
      '--file', 'mock.csv',
      '--output-dir', './output',
      '--target-org', 'testOrgAlias',
      '--id', 'CustomId', // Use the custom ID field
      '--ext-col-name', 'Ext',
    ]);

    expect(mockConnectionRequest.calledOnce).to.be.true;
    const requestBody = JSON.parse(mockConnectionRequest.getCall(0).args[0].body);
    expect(requestBody.batchRequests).to.have.lengthOf(2);
    // Verify URLs use IDs from 'CustomId' column
    expect(requestBody.batchRequests[0].url).to.include('/sobjects/ContentVersion/00001/VersionData');
    expect(requestBody.batchRequests[1].url).to.include('/sobjects/ContentVersion/00002/VersionData');
    // Ensure default 'Id' column was ignored
    expect(requestBody.batchRequests[0].url).to.not.include('/sobjects/ContentVersion/99999/VersionData');
    expect(requestBody.batchRequests[1].url).to.not.include('/sobjects/ContentVersion/88888/VersionData');

    expect(writeFileSyncStub.callCount).to.equal(2);
    expect(writtenFiles.get(path.join('./output', '00001.txt'))?.toString()).to.equal(fileContentMap.get('00001'));
    expect(writtenFiles.get(path.join('./output', '00002.doc'))?.toString()).to.equal(fileContentMap.get('00002'));
  });

  it('should handle batching for more than 25 records', async () => {
    const recordCount = 30;
    let csvLines = ['Id,Ext'];
    const expectedFileContents: Array<{ id: string, ext: string, content: string, b64Content: string }> = [];

    for (let i = 1; i <= recordCount; i++) {
      const id = `id_${i.toString().padStart(5, '0')}`;
      const ext = 'txt';
      const content = `Content for ${id}`;
      csvLines.push(`${id},${ext}`);
      expectedFileContents.push({ id, ext, content, b64Content: Buffer.from(content).toString('base64') });
    }
    currentCsvData = csvLines.join('\n');

    // First batch (25 records)
    mockConnectionRequest.onFirstCall().resolves({
      hasErrors: false,
      results: expectedFileContents.slice(0, 25).map(f => ({ statusCode: 200, result: f.b64Content })),
    });
    // Second batch (remaining 5 records)
    mockConnectionRequest.onSecondCall().resolves({
      hasErrors: false,
      results: expectedFileContents.slice(25).map(f => ({ statusCode: 200, result: f.b64Content })),
    });

    await FileExport.run(['--file', 'mock_large.csv', '--output-dir', './output_large', '--target-org', 'testOrgAlias', '--ext-col-name', 'Ext']);

    expect(mockConnectionRequest.callCount).to.equal(2); // Two batches

    // Verify first batch request details (optional, but good for sanity)
    const firstBatchBody = JSON.parse(mockConnectionRequest.getCall(0).args[0].body);
    expect(firstBatchBody.batchRequests).to.have.lengthOf(25);
    // Verify second batch request details
    const secondBatchBody = JSON.parse(mockConnectionRequest.getCall(1).args[0].body);
    expect(secondBatchBody.batchRequests).to.have.lengthOf(5);


    expect(writeFileSyncStub.callCount).to.equal(recordCount); // All files should be "written"
    for (const fileDetail of expectedFileContents) {
      const expectedPath = path.join('./output_large', `${fileDetail.id}.${fileDetail.ext}`);
      expect(writtenFiles.get(expectedPath)?.toString()).to.equal(fileDetail.content);
    }

    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include(`Total records to process: ${recordCount}`);
    expect(logs).to.include('Processing batch 1 of 2...');
    expect(logs).to.include('Processing batch 2 of 2...');
    expect(logs).to.include(`Export complete. ${recordCount} files exported successfully, 0 files failed.`);
  });

  it('should handle an empty CSV file gracefully', async () => {
    currentCsvData = ''; // Empty CSV
    // Or: currentCsvData = 'Id,Ext'; // Headers only

    await FileExport.run(['--file', 'empty.csv', '--output-dir', './output', '--target-org', 'testOrgAlias']);

    expect(mockConnectionRequest.called).to.be.false; // No API calls should be made
    expect(writeFileSyncStub.called).to.be.false; // No files written, no error log

    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include('No records found in CSV file to process.');
    // The command resolves with { successCount: 0, failureCount: 0 } which is handled by the base Command class.
    // We just need to check the logs.
  });
  
  it('should handle a CSV file with only headers gracefully', async () => {
    currentCsvData = 'Id,Ext'; // Headers only

    await FileExport.run(['--file', 'headers_only.csv', '--output-dir', './output', '--target-org', 'testOrgAlias']);

    expect(mockConnectionRequest.called).to.be.false; 
    expect(writeFileSyncStub.called).to.be.false;

    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include('No records found in CSV file to process.');
  });


  it('should handle a CSV file where all records result in errors', async () => {
    currentCsvData = 'Id,Ext\nerror1,txt\nerror2,doc';
    const errorResult1 = [{ errorCode: 'INVALID_ID_FIELD', message: 'Id not valid for error1' }];
    const errorResult2 = [{ errorCode: 'UNKNOWN_ERROR', message: 'Some server issue for error2' }];

    mockConnectionRequest.resolves({
      hasErrors: true,
      results: [
        { statusCode: 400, result: errorResult1 },
        { statusCode: 500, result: errorResult2 },
      ],
    });

    await FileExport.run(['--file', 'errors.csv', '--output-dir', './output_errors', '--target-org', 'testOrgAlias', '--ext-col-name', 'Ext']);

    expect(mockConnectionRequest.calledOnce).to.be.true;
    
    // Check that no successful files were written to the main output directory
    const successfulFileWrites = Array.from(writtenFiles.keys()).filter(p => p.startsWith('./output_errors'));
    expect(successfulFileWrites.length).to.equal(0);


    // Check that an error CSV was written
    const errorLogCall = writeFileSyncStub.getCalls().find(call => (call.args[0] as string).startsWith('errors'));
    expect(errorLogCall).to.not.be.undefined;
    const errorCsvContent = writtenFiles.get(errorLogCall!.args[0] as string)?.toString();

    expect(errorCsvContent).to.include('error1,"Error in batch sub-request for ID error1"');
    expect(errorCsvContent).to.include('Status 400: Id not valid for error1');
    expect(errorCsvContent).to.include('error2,"Error in batch sub-request for ID error2"');
    expect(errorCsvContent).to.include('Status 500: Some server issue for error2');


    const logs = sfCommandStubs.log.getCalls().map(c => c.args[0]).join('\n');
    expect(logs).to.include('Export complete. 0 files exported successfully, 2 files failed.');
  });
});
