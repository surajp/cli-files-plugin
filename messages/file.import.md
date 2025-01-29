# summary

Summary of a command.

# description

More information about a command. Don't repeat the summary.

# flags.file.summary

The file containing ContentVersion data to be imported.

# flags.file.description

The csv file should atleast have `Title`, `PathOnClient`, `VersionData` columns. VersionData should be the path to the file to be imported. Any additional columns should exactly match the field api name of a standard or custom field on the ContentVersion object.

# flags.batch-size.summary

The total size of files to import in a single batch. (a single composite api call)

# flags.batch-size.description

The default value is 30MB. Reduce this value if you have a large number of small files to import to avoid hitting the limit of 200 records per subrequest.

# flags.concurrency.summary

The number of concurrent batches to import.

# flags.concurrency.description

More concurrent requests will be faster but may cause the Salesforce API to return errors and throttle system resources. The default value is 3.

# examples

- <%= config.bin %> <%= command.id %>
