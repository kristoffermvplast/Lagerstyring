// Emit only fixed allowlisted text. Never serialize driver errors or their fields.
function diagnostic(error, stage) {
  const codes = {
    '28P01': 'AUTHENTICATION_FAILED: Database rejected credentials; check role password and connection configuration.',
    '28000': 'AUTHORIZATION_FAILED: Login/role rejected by database or pooler.',
    '42501': 'PERMISSION_DENIED: Database rejected an operation; inspect schema and role grants.',
    '3D000': 'DATABASE_NOT_FOUND: Configured database does not exist.',
    '3F000': 'SCHEMA_NOT_FOUND: Required schema does not exist.',
    '42704': 'OBJECT_NOT_FOUND: Required database role or object is missing.',
    '53300': 'CONNECTION_LIMIT: Database connection capacity exceeded.',
    ENOTFOUND: 'DNS_FAILED: Database hostname could not be resolved.',
    EAI_AGAIN: 'DNS_TEMPORARY_FAILURE: Database hostname resolution failed temporarily.',
    ECONNREFUSED: 'CONNECTION_REFUSED: Database endpoint refused the connection.',
    ECONNRESET: 'CONNECTION_RESET: Remote endpoint closed the connection.',
    ETIMEDOUT: 'CONNECTION_TIMEOUT: Database connection timed out.',
    ENETUNREACH: 'NETWORK_UNREACHABLE: Database network is unreachable.',
    EHOSTUNREACH: 'HOST_UNREACHABLE: Database host is unreachable.',
  };
  const tlsCodes = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);
  if (tlsCodes.has(error?.code)) return 'TLS_CERTIFICATE_FAILED: Certificate verification failed; check trusted CA, hostname and certificate validity. Do not disable verification.';
  if (Object.hasOwn(codes, error?.code)) return codes[error.code];
  const messages = {
    DATABASE_URL_MISSING: 'DATABASE_URL_MISSING: Required backend secret is absent.',
    TLS_CLIENT_CHECK_FAILED: 'TLS_CLIENT_CHECK_FAILED: Active client connection did not pass encryption, certificate and hostname checks.',
    TLS_REQUIRED: 'TLS_REQUIRED: Hosted verification requires DATABASE_SSL_MODE=require.',
    ROLE_CHECK_FAILED: 'ROLE_CHECK_FAILED: Inspect the preceding PASS/FAIL checks for identity, membership and schema rights.',
    READINESS_FAILED: 'READINESS_FAILED: NestJS readiness check did not pass.',
    'Connection terminated due to connection timeout': 'CONNECTION_TIMEOUT: Database connection timed out.',
    'Query read timeout': 'QUERY_TIMEOUT: Database did not answer in time.',
    'The server does not support SSL connections': 'TLS_UNSUPPORTED: Endpoint rejected TLS.',
  };
  if (Object.hasOwn(messages, error?.message)) return messages[error.message];
  if (stage === 'configuration') return 'CONFIGURATION_INVALID: Check backend environment values, restricted username, URL encoding and absence of URL query parameters.';
  if (stage === 'tls_setup') return 'TLS_CONFIGURATION_INVALID: Check TLS mode and readability of the configured CA file.';
  return 'UNCLASSIFIED_DATABASE_FAILURE: Connection or verification failed without a recognized safe error code. No raw error details were printed.';
}
module.exports = { diagnostic };
