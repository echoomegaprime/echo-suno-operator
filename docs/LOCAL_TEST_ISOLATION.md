# Local HTTP test isolation and listener identity

The security test previously used fixed port18789. On QUENCH an unrelated service
already owned127.0.0.1:18789. Windows allowed the candidate to bind0.0.0.0:18789
at the same time. The candidate printed a startup message, but requests to
127.0.0.1 reached the other listener and returned404. A startup log alone did not
prove the test endpoint belonged to the new child. The unrelated process was
preserved throughout diagnosis.

The security test now requests port0 on127.0.0.1, reads the actual assigned port
from a structured startup event, and requires the child PID and loopback address
to match before sending requests. Its readiness listeners are removed on every
exit path. Tests terminate only their own child and await its exit.

The service defaults to127.0.0.1, matching the documented loopback OAuth proxy
architecture. An operator may explicitly set HOST for another bind address;
review existing network consumers before deploying this default change. The
human-readable startup line reports the actual assigned port. Structured events
contain host, port and PID, never provider/session/token data. SUNO_DEBUG=1 adds
a bounded startup-intent event. A listen failure emits a fixed error code and
exits unsuccessfully.

The startup regression owns a separate ephemeral loopback socket, proves that
the default-bound child fails with EADDRINUSE without announcing readiness, and
checks that the original fixture still answers. The suite requires no provider
session or paid generation. Production authentication, OAuth consent and CAPTCHA
acceptance remain separate from these local checks.
