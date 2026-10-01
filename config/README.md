# Runtime secrets

Local runtime secret files live here and are ignored by Git. Automatic Chat translation reads
`config/azure-translator.key` as a single-line Azure Translator subscription key through Compose's read-only
configuration mount. Translation is optional; a fresh self-hosted server does not need this file.

Restrict access to any key file on the host, and never commit it.
