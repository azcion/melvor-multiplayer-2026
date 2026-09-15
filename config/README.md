# Runtime secrets

Local runtime secret files live here and are ignored by Git. Automatic Chat translation reads
`config/azure-translator.key` as a single-line Azure Translator subscription key. The Raspberry Pi deployment helper
copies that file into each deployed source snapshot with mode `0600` when it is present locally.

Never commit key files from this directory.
