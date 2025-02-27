# Salesforce CLI File Operations Plugin

[![NPM](https://img.shields.io/npm/v/file-export.svg?label=file-export)](https://www.npmjs.com/package/file-export) [![Downloads/week](https://img.shields.io/npm/dw/file-export.svg)](https://npmjs.org/package/file-export) [![License](https://img.shields.io/badge/License-BSD%203--Clause-brightgreen.svg)](https://raw.githubusercontent.com/salesforcecli/file-export/main/LICENSE.txt)

## Install

```bash
sf plugins install @neatflow/fileops
```

## Issues

Please report any issues at https://github.com/surajp/cli-files-plugin/issues

### Build

To build the plugin locally, make sure to have yarn installed and run the following commands:

```bash
# Clone the repository
git clone git@github.com:surajp/cli-files-plugin.git

# Install the dependencies and compile
yarn && yarn build
```

To use your plugin, run using the local `./bin/dev` or `./bin/dev.cmd` file.

```bash
# Run using local run file.
./bin/dev fileops export
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

- [`sf fileops export`](#sf-fileops-export)
- [`sf fileops import`](#sf-fileops-import)

## `sf fileops export`

Export binary data for ContentVersion records (Files) from Salesforce

```
USAGE
  $ sf fileops export -f <value> -d <value> -o <value> [--json] [--flags-dir <value>] [-c <value>] [-i <value>] [-e
    <value>]

FLAGS
  -c, --concurrency=<value>   [default: 3] The number of concurrent requests to make to the Salesforce API.
  -d, --output-dir=<value>    (required) The directory to save the exported contentversion files. The path may be
                              absolute or relative to the current working directory.
  -e, --ext-col-name=<value>  File extension column name.
  -f, --file=<value>          (required) The file containing contentversion ids.
  -i, --id=<value>            [default: Id] Name of the column in the CSV file that contains the ContentVersion Ids.
  -o, --target-org=<value>    (required) Username or alias of the target org. Not required if the `target-org`
                              configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Export binary data for ContentVersion records (Files) from Salesforce

  The command uses concurrent processes to speed up the export process. The input csv file should contain the
  ContentVersion Ids to be exported.

EXAMPLES
  $ sf fileops export --file contentversion-ids.csv

FLAG DESCRIPTIONS
  -c, --concurrency=<value>  The number of concurrent requests to make to the Salesforce API.

    More concurrent requests will be faster but may cause the Salesforce API to return errors and throttle system
    resources.

  -d, --output-dir=<value>

    The directory to save the exported contentversion files. The path may be absolute or relative to the current working
    directory.

    The directory will be created if it does not exist. The exported files will be saved in the directory with the Id as
    the filename. If using an existing directory, any files with the same name will be overwritten.

  -e, --ext-col-name=<value>  File extension column name.

    Name of the column in the csv file containing the file extension. The column may contain just the extension (eg:
    pdf, jpeg, etc.) or filename including extension (eg: AnnualReport.pdf). If specified, the downloaded file will be
    named <fileid>.<extension>. If not, it will just be named <file id>

  -f, --file=<value>  The file containing contentversion ids.

    The csv file should have a column `Id` with the contentversion ids to be exported. The file may contain additional
    columns, but they will be ignored.
```

## `sf fileops import`

Import ContentVersion records into Salesforce, in bulk.

```
USAGE
  $ sf fileops import -f <value> -o <value> [--json] [--flags-dir <value>] [-b <value>] [-c <value>]

FLAGS
  -b, --batch-size=<value>   [default: 30] The total size of files (in MB) to import in a single batch. (a single
                             composite api call)
  -c, --concurrency=<value>  [default: 3] Number of parallel batches
  -f, --file=<value>         (required) The file containing ContentVersion data to be imported.
  -o, --target-org=<value>   (required) Username or alias of the target org. Not required if the `target-org`
                             configuration variable is already set.

GLOBAL FLAGS
  --flags-dir=<value>  Import flag values from a directory.
  --json               Format output as json.

DESCRIPTION
  Import ContentVersion records into Salesforce, in bulk.

  The command uses composite api and concurrent batches to speed up the upload process. The input csv file should
  contain the following columns: `Title`, `PathOnClient`, `VersionData`. The `VersionData` column should contain the
  path to the file to be imported. Any additional columns should exactly match the field api name of a standard or
  custom field on the ContentVersion object. For looking up parent records based on an `idLookup` field, the column name
  should be `<LookupField>.ParentFieldName` (eg: Contact\_\_r.Email). For a polymorphic lookup field like
  `FirstPublishLocationId`, the column name should be `FirstPublishLocation:<ParentObject>.<ParentField>` (eg:
  FirstPublishLocation:Contact.Email).

EXAMPLES
  $ sf fileops import

FLAG DESCRIPTIONS
  -b, --batch-size=<value>

    The total size of files (in MB) to import in a single batch. (a single composite api call)

    The default value is 30MB. Irrespective of the batch size, the program will ensure there are no more than 190 files
    in a single batch to stay within the composite api subrequests limit of 200.

  -f, --file=<value>  The file containing ContentVersion data to be imported.

    The csv file should atleast have `Title`, `PathOnClient`, `VersionData` columns. VersionData should be the path to
    the file to be imported. Any additional columns should exactly match the field api name of a standard or custom
    field on the ContentVersion object.
```

<!-- commandsstop -->
