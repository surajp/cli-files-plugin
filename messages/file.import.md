# summary

Import ContentVersion records into Salesforce, in bulk.

# description

The command uses composite api and concurrent batches to speed up the upload process. The input csv file should contain the following columns: `Title`, `PathOnClient`, `VersionData`. The `VersionData` column should contain the path to the file to be imported. Any additional columns should exactly match the field api name of a standard or custom field on the ContentVersion object.

# flags.file.summary

The file containing ContentVersion data to be imported.

# flags.file.description

The csv file should atleast have `Title`, `PathOnClient`, `VersionData` columns. VersionData should be the path to the file to be imported. Any additional columns should exactly match the field api name of a standard or custom field on the ContentVersion object.

# flags.batch-size.summary

The total size of files (in MB) to import in a single batch. (a single composite api call)

# flags.batch-size.description

The default value is 30MB. Irrespective of the batch size, the program will ensure there are no more than 190 files in a single batch to stay within the composite api subrequests limit of 200.

# flags.concurrency.summary

The number of concurrent batches to import.

# flags.concurrency.description

More concurrent requests will be faster but may cause the Salesforce API to return errors and throttle system resources. The default value is 3.

# examples

- <%= config.bin %> <%= command.id %>
