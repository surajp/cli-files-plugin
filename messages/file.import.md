# summary

Summary of a command.

# description

More information about a command. Don't repeat the summary.

# flags.file.summary

The file containing ContentVersion data to be imported.

# flags.file.description

The csv file should atleast have `Title`, `PathOnClient`, `VersionData` columns. VersionData should be the path to the file to be imported. Any additional columns should exactly match the field api name of a standard or custom field on the ContentVersion object.

# flags.concurrency.summary

The number of concurrent requests to make to the Salesforce API.

# flags.concurrency.description

More concurrent requests will be faster but may cause the Salesforce API to return errors and throttle system resources.

# examples

- <%= config.bin %> <%= command.id %>
