// routes/test-only-auth.js
// FOR LOCAL SANDBOX TESTING ONLY — simulates a LINE login session without
// hitting LINE's real OAuth servers (which this sandbox can't reach).
// Gated behind ENABLE_TEST_AUTH=1, never enabled in production.
module.exports = function (router) {
  router.get('/test-only/fake-login', (req, res) => {
    const { userId, name } = req.query;
    req.session.lineProfile = {
      userId: userId || 'test-user-' + Date.now(),
      displayName: name || 'Test User',
      pictureUrl: null,
    };
    res.json({ ok: true, profile: req.session.lineProfile });
  });
};
