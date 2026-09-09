const { TLSSocket, checkServerIdentity } = require('node:tls');

// Inspect the connected pg client's actual transport. Never serialize the client,
// certificate, hostname, URL or authorizationError. Missing evidence fails closed.
function clientTlsChecks(client) {
  const socket = client?.connection?.stream;
  const tlsSocket = socket instanceof TLSSocket;
  let hostnameOk = false;
  try {
    hostnameOk = tlsSocket && typeof client.host === 'string' &&
      checkServerIdentity(client.host, socket.getPeerCertificate()) === undefined;
  } catch { /* Missing certificate or unsupported driver: fail closed. */ }
  return {
    client_tls_encrypted: tlsSocket && socket.encrypted === true &&
      ['TLSv1.2', 'TLSv1.3'].includes(socket.getProtocol()),
    client_tls_authorized: tlsSocket && socket.authorized === true,
    client_tls_hostname: hostnameOk,
  };
}

module.exports = { clientTlsChecks };
