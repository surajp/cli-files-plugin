import fs from 'node:fs';
import { Readable } from 'node:stream';
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import sinon, { SinonStub } from 'sinon';
import axios from 'axios';
import FileExport from '../../../src/commands/file/export.js';

type AxiosResponse = {
  data: Readable;
  headers: Record<string, string>;
};

describe('file export', () => {
  const $$: TestContext = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('should ensure output directory exists', async () => {
    const mkdirSyncStub: SinonStub = $$.SANDBOX.stub(fs, 'mkdirSync');
    const existsSyncStub: SinonStub = $$.SANDBOX.stub(fs, 'existsSync').returns(false);

    FileExport['ensureOutputDirectory']('test-output-dir');
    expect(existsSyncStub.calledOnceWith('test-output-dir')).to.be.true;
    expect(mkdirSyncStub.calledOnceWith('test-output-dir', { recursive: true })).to.be.true;
  });

  it('should process a valid CSV file and download files', async () => {
    const csvData: Array<{ Id: string }> = [{ Id: '12345' }, { Id: '67890' }];
    const createReadStreamStub: SinonStub = $$.SANDBOX.stub(fs, 'createReadStream').returns({
      pipe: sinon.stub().callsFake((stream: Readable) => {
        stream.emit('data', csvData[0]);
        stream.emit('data', csvData[1]);
        stream.emit('end');
        return stream;
      }),
    } as unknown as fs.ReadStream);

    const axiosGetStub: SinonStub = $$.SANDBOX.stub(axios, 'get').resolves({
      data: new Readable({
        read() {
          this.push(null); // Simulate end of stream
        },
      }),
      headers: { 'content-length': '100' },
    } as AxiosResponse);

    const writeStreamStub: SinonStub = $$.SANDBOX.stub(fs, 'createWriteStream').returns({
      on: sinon.stub().callsFake((event: string, callback: () => void) => {
        if (event === 'finish') callback();
      }),
      pipe: sinon.stub(),
    } as unknown as fs.WriteStream);

    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': sinon.stub(),
      'api-version': undefined,
    };

    await FileExport.run([
      '--file',
      flags.file,
      '--output-dir',
      flags['output-dir'],
      '--concurrency',
      `${flags.concurrency}`,
      '--target-org',
      'test-org',
    ]);

    expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
    expect(axiosGetStub.callCount).to.equal(csvData.length);
    expect(writeStreamStub.callCount).to.equal(csvData.length);
  });

  it('should handle errors during file processing', async () => {
    const csvData: Array<{ Id: string }> = [{ Id: '12345' }];
    $$.SANDBOX.stub(fs, 'createReadStream').returns({
      pipe: sinon.stub().callsFake((stream: Readable) => {
        stream.emit('data', csvData[0]);
        stream.emit('end');
        return stream;
      }),
    } as unknown as fs.ReadStream);

    $$.SANDBOX.stub(axios, 'get').rejects(new Error('Network error'));

    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': sinon.stub(),
      'api-version': undefined,
    };

    try {
      await FileExport.run([
        '--file',
        flags.file,
        '--output-dir',
        flags['output-dir'],
        '--concurrency',
        `${flags.concurrency}`,
        '--target-org',
        'test-org',
      ]);
    } catch (error) {
      expect((error as Error).message).to.include('Failed to process ContentVersion ID');
    }
  });

  it('should fail when CSV file cannot be read', async () => {
    const createReadStreamStub: SinonStub = $$.SANDBOX.stub(fs, 'createReadStream').throws(new Error('File not found'));

    const flags = {
      file: './nonexistent.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': sinon.stub(),
      'api-version': undefined,
    };

    try {
      await FileExport.run([
        '--file',
        flags.file,
        '--output-dir',
        flags['output-dir'],
        '--concurrency',
        `${flags.concurrency}`,
        '--target-org',
        'test-org',
      ]);
    } catch (error) {
      expect((error as Error).message).to.include('File not found');
    }

    expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
  });

  it('should log progress and completion message', async () => {
    const csvData: Array<{ Id: string }> = [{ Id: '12345' }];
    const readStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').returns({
      pipe: (stream: Readable) => {
        stream.emit('data', csvData[0]);
        stream.emit('end');
        return stream;
      },
    } as unknown as fs.ReadStream);

    const axiosStub = $$.SANDBOX.stub(axios, 'get').resolves({
      data: new Readable({
        read() {
          this.push(null); // Simulate end of stream
        },
      }),
      headers: { 'content-length': '100' },
    } as AxiosResponse);

    $$.SANDBOX.stub(fs, 'createWriteStream').returns({
      on: sinon.stub().callsFake((event: string, callback: () => void) => {
        if (event === 'finish') callback();
      }),
      pipe: sinon.stub(),
    } as unknown as fs.WriteStream);

    await FileExport.run([
      '--file',
      './mock.csv',
      '--output-dir',
      './output',
      '--concurrency',
      '1',
      '--target-org',
      'test-org',
    ]);

    const outputLogs: string[] = sfCommandStubs.log.getCalls().flatMap((call) => call.args.join('\n'));
    expect(outputLogs, 'expected output logs to include Processing first row').to.include('Processing first row');
    expect(readStreamStub.callCount, 'expected read stream to be called once').to.equal(csvData.length);
    expect(axiosStub.callCount, 'expected axios to be called once').to.equal(csvData.length);
  });
});
