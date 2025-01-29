# file-export

[![NPM](https://img.shields.io/npm/v/file-export.svg?label=file-export)](https://www.npmjs.com/package/file-export) [![Downloads/week](https://img.shields.io/npm/dw/file-export.svg)](https://npmjs.org/package/file-export) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/file-export/main/LICENSE.txt)

## Install

```bash
sf plugins install file-export@x.y.z
```

## Issues

Please report any issues at https://github.com/forcedotcom/cli/issues

### Build

To build the plugin locally, make sure to have yarn installed and run the following commands:

```bash
# Clone the repository
git clone git@github.com:surajp/file-export

# Install the dependencies and compile
yarn && yarn build
```

To use your plugin, run using the local `./bin/dev` or `./bin/dev.cmd` file.

```bash
# Run using local run file.
./bin/dev file export
```

There should be no differences when running via the Salesforce CLI or using the local run file. However, it can be useful to link the plugin to do some additional testing or run your commands from anywhere on your machine.

```bash
# Link your plugin to the sf cli
sf plugins link .
# To verify
sf plugins
```

## Commands

<!-- commands -->

- [`sf file export`](#sf-file-export)

## `sf file export`

Export files' binary data from Salesforce.

```
USAGE
  $ sf file export --file <file> --output-dir <output-dir> [--concurrency <concurrency>] [--ext-col-name <ext-col-name>] [--id <id>] [--target-org <target-org>]

FLAGS
  -f, --file=file  (required) The file containing contentversion ids.
  -d, --output-dir=output-dir  (required) The directory to save the exported contentversion files. The path may be absolute or relative to the current working directory.
  -c, --concurrency=concurrency  The number of concurrent requests to make to the Salesforce API.
  -e, --ext-col-name=ext-col-name  File extension column name.
  -i, --id=id  Name of the column in the CSV file that contains the ContentVersion Ids. The default value is `Id`.
  -o, --target-org=target-org  The target org to export the files from.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Export files' binary data from Salesforce.

EXAMPLES
   Export files' binary data from Salesforce for the contentversion ids in the file contentversion-ids.csv.
    $ sf file export --file contentversion-ids.csv

  Increase concurrency to speed up the export process.
    $ sf file export --file contentversion-ids.csv --concurrency 10
```

<!-- commandsstop -->
