import fs, { PathLike, Stats } from 'node:fs';
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
  const csvData: string = 'Id\n12345\n67890';
  let createReadStreamStub: SinonStub;
  let writeStreamStub: SinonStub;
  let axiosGetStub: SinonStub;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);

    // this is needed for flag exists: true check to work with a mock file
    $$.SANDBOX.stub(fs.promises, 'stat').resolves({
      size: 100,
      isFile: () => true,
    } as Stats);

    createReadStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').callsFake((path: PathLike) => {
      expect(path).to.be.not.undefined;
      const stream = new Readable({
        read() {
          this.push(Buffer.from(csvData));
          this.push(null); // Signal end of stream
        },
      });
      return stream as fs.ReadStream;
    });

    let finishCallback: () => void;
    writeStreamStub = $$.SANDBOX.stub(fs, 'createWriteStream').returns({
      on: sinon.stub().callsFake((event: string, callback: () => void) => {
        if (event === 'finish') finishCallback = callback;
      }),
      write: sinon.stub(),
      end: sinon.stub().callsFake(() => {
        if (finishCallback) finishCallback();
      }),
      once: sinon.stub(),
      emit: sinon.stub(),
    } as unknown as fs.WriteStream);

    axiosGetStub = $$.SANDBOX.stub(axios, 'get').callsFake((url: string) => {
      expect(url).to.be.not.undefined;
      return Promise.resolve({
        data: new Readable({
          read() {
            this.push(Buffer.from('somedata'));
            this.push(null); // Simulate end of stream
          },
        }),
        headers: { 'content-length': '100' },
      } as AxiosResponse);
    });
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
    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': 'mockOrg',
    };

    await FileExport.run([
      '--file',
      flags.file,
      '--output-dir',
      flags['output-dir'],
      '--concurrency',
      `${flags.concurrency}`,
      '--target-org',
      flags['target-org'],
    ]);

    expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
    expect(axiosGetStub.callCount, 'expected axios to be called twice').to.equal(2);
    expect(writeStreamStub.callCount, 'expected write stream to be called twice').to.equal(2);
    sfCommandStubs.log.getCalls().flatMap((call) => call.args.join('\n'));
  });

  it('should handle errors during file processing', async () => {
    axiosGetStub.restore();
    $$.SANDBOX.stub(axios, 'get').callsFake((url: string) => {
      expect(url).to.be.not.undefined;
      return Promise.reject(new Error('Failed to download file'));
    });

    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': 'mockOrg',
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
        flags['target-org'],
      ]);
    } catch (error) {
      expect((error as Error).message).to.include('Failed to process ContentVersion ID');
    }
  });

  it('should fail when CSV file cannot be read', async () => {
    createReadStreamStub.throws(new Error('File not found'));

    const flags = {
      file: './nonexistent.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': 'mockOrg',
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
        flags['target-org'],
      ]);
    } catch (error) {
      expect((error as Error).message).to.include('File not found');
    }
    expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
  });

  it('should log progress and completion message', async () => {
    await FileExport.run([
      '--file',
      './mock.csv',
      '--output-dir',
      './output',
      '--concurrency',
      '1',
      '--target-org',
      'mockOrg',
    ]);

    const outputLogs: string[] = sfCommandStubs.log.getCalls().flatMap((call) => call.args as string[]);

    expect(outputLogs.join('\n'), 'expected output logs to include Export complete').to.deep.include('Export complete');
  });

  it('should handle alternate ID field name', async () => {
    const customIdColumn = 'customid';
    const csvDataWithCustomId: string = `${customIdColumn},Id\n65432,11111\n54321,22222`; // csv data with both default and custom id fields. Only the custom id field should be used

    createReadStreamStub.restore();

    createReadStreamStub = $$.SANDBOX.stub(fs, 'createReadStream').callsFake((path: PathLike) => {
      expect(path).to.be.not.undefined;
      const stream = new Readable({
        read() {
          this.push(Buffer.from(csvDataWithCustomId));
          this.push(null);
        },
      });
      return stream as fs.ReadStream;
    });

    const flags = {
      file: './mock.csv',
      'output-dir': './output',
      concurrency: 1,
      'target-org': 'mockOrg',
      id: customIdColumn,
    };

    await FileExport.run([
      '--file',
      flags.file,
      '--output-dir',
      flags['output-dir'],
      '--concurrency',
      `${flags.concurrency}`,
      '--target-org',
      flags['target-org'],
      '--id',
      flags.id,
    ]);

    expect(createReadStreamStub.calledOnceWith(flags.file)).to.be.true;
    expect(axiosGetStub.callCount, 'expected axios to be called twice').to.equal(2);
    const axiosUrlIds: string[] = axiosGetStub
      .getCalls()
      .map((call) => (call.args[0] as string).replace(/.*\/(.*\/VersionData)/, '$1')); // only get the id/VersionData from the url
    expect(axiosUrlIds).to.include('65432/VersionData'); // ensure the id is being read from the custom field and passed to axios for fetching
    expect(axiosUrlIds).to.not.include('11111/VersionData'); // ensure the default id field is not being used
    expect(writeStreamStub.callCount, 'expected write stream to be called twice').to.equal(2);
  });
});
