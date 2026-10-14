const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/monitoring/sentry-shared.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: mod.exports, module: mod, process, RegExp })

const { redactUrl, isNextNavigationSignal, DATA_COLLECTION, SECRET_PARAMS, resolveDsn, FALLBACK_DSN,
  matchesIgnoredError, retitleSerializedException } = mod.exports

// request-timeout.ts has no imports, so it transpiles and runs standalone too.
const timeoutMod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/supabase/request-timeout.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: timeoutMod.exports, module: timeoutMod, process, RegExp, Error, URL, Request,
  AbortController, DOMException, setTimeout, clearTimeout, Promise, Date, globalThis,
})

const { createSupabaseReadTimeoutFetch, isSupabaseRequestTimeout } = timeoutMod.exports
const SUPABASE_URL = 'https://swyvftqciilslyzfdoli.supabase.co'
const READ_URL = `${SUPABASE_URL}/rest/v1/programs?select=id&status=eq.active`

/** Swap globalThis.fetch for the duration of one assertion. */
async function withFetch(impl, run) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try { return await run() } finally { globalThis.fetch = original }
}

test('error reports never carry a Supabase session token', () => {
  // Supabase returns these in the URL fragment after a magic link or OAuth
  // callback, and that URL lands in Sentry breadcrumbs.
  assert.equal(
    redactUrl('https://app.tcnp.org/login#access_token=eyJhbGc.secret&expires_in=3600'),
    'https://app.tcnp.org/login#access_token=[REDACTED]&expires_in=3600',
  )
  assert.equal(
    redactUrl('/auth/callback?code=abc123&refresh_token=zzz&next=/dashboard'),
    '/auth/callback?code=[REDACTED]&refresh_token=[REDACTED]&next=/dashboard',
  )
  // Casing varies between providers.
  assert.equal(redactUrl('/x?Access_Token=abc'), '/x?Access_Token=[REDACTED]')
})

test('redaction leaves ordinary debugging context intact', () => {
  const url = '/journeys?program=123&status=active'
  assert.equal(redactUrl(url), url)
  assert.equal(redactUrl(''), '')
})

test('redaction covers every parameter the deny list names', () => {
  for (const param of SECRET_PARAMS) {
    assert.equal(redactUrl(`/x?${param}=leaked`), `/x?${param}=[REDACTED]`)
  }
})

test('App Router redirects are not reported as errors', () => {
  // proxy.ts redirects unauthenticated navigations on every single request.
  // Reporting these would bury real failures and burn the error quota.
  assert.equal(isNextNavigationSignal({ digest: 'NEXT_REDIRECT;replace;/login;307;' }), true)
  assert.equal(isNextNavigationSignal({ digest: 'NEXT_NOT_FOUND' }), true)
  assert.equal(isNextNavigationSignal(new Error('NEXT_REDIRECT')), true)
})

test('real failures are still reported', () => {
  assert.equal(isNextNavigationSignal(new Error('Cannot read properties of undefined')), false)
  assert.equal(isNextNavigationSignal({ digest: 'abc123' }), false)
  assert.equal(isNextNavigationSignal(null), false)
  assert.equal(isNextNavigationSignal(undefined), false)
  assert.equal(isNextNavigationSignal('NEXT_REDIRECT'), false)
})

test('SDK is not allowed to auto-collect officer data', () => {
  // SDK v11 replaced `sendDefaultPii` with `dataCollection` AND inverted the
  // defaults: cookies, headers and request bodies are collected unless
  // disabled. If any of these flip back on, session cookies and journey
  // payloads start leaving the device.
  assert.equal(DATA_COLLECTION.cookies, false)
  assert.equal(DATA_COLLECTION.httpHeaders, false)
  assert.equal(DATA_COLLECTION.httpBodies.length, 0)
  assert.equal(DATA_COLLECTION.userInfo, false)
  assert.equal(DATA_COLLECTION.stackFrameVariables, false)
  assert.equal(DATA_COLLECTION.databaseQueryData, false)
  // Query params are kept for debugging, with secrets denied.
  assert.equal(
    JSON.stringify(DATA_COLLECTION.urlQueryParams.deny),
    JSON.stringify(SECRET_PARAMS),
  )
})

test('the environment DSN always wins over the committed fallback', () => {
  // The fallback exists only for deployments where nobody can set env vars.
  // If it ever shadowed the env var, staging errors would land in the wrong
  // project and nobody would notice.
  assert.equal(resolveDsn('https://env@o1.ingest.de.sentry.io/1'), 'https://env@o1.ingest.de.sentry.io/1')
})

test('no DSN anywhere leaves the SDK inert', () => {
  assert.equal(FALLBACK_DSN, '', 'commit the DSN deliberately, not by accident')
  assert.equal(resolveDsn(undefined), undefined)
  assert.equal(resolveDsn(''), undefined)
  // A var set to whitespace in a dashboard must not count as configured.
  assert.equal(resolveDsn('   '), undefined)
})

test('a read that outlives its deadline is reported as a timeout, not an anonymous abort', async () => {
  // Before this, the 15s deadline called controller.abort() with no reason, so
  // a slow Supabase surfaced in Sentry as "AbortError: signal is aborted
  // without reason" — naming neither the deadline nor the request.
  const boundedFetch = createSupabaseReadTimeoutFetch(SUPABASE_URL, 10)
  await withFetch(
    (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason
        ?? new DOMException('signal is aborted without reason', 'AbortError')))
    }),
    async () => {
      const error = await boundedFetch(READ_URL).then(() => null, (e) => e)
      assert.ok(isSupabaseRequestTimeout(error), `expected a timeout, got: ${error}`)
      assert.match(error.message, /did not respond within 10ms/)
    },
  )
})

test('a caller cancelling is still an abort, not a timeout', async () => {
  // Navigating away mid-load must stay distinguishable from Supabase being
  // slow, otherwise the ignore list would silence real timeouts.
  const boundedFetch = createSupabaseReadTimeoutFetch(SUPABASE_URL, 10_000)
  const controller = new AbortController()
  await withFetch(
    (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason
        ?? new DOMException('signal is aborted without reason', 'AbortError')))
    }),
    async () => {
      const pending = boundedFetch(READ_URL, { signal: controller.signal })
      controller.abort(new DOMException('user navigated away', 'AbortError'))
      const error = await pending.then(() => null, (e) => e)
      assert.equal(isSupabaseRequestTimeout(error), false)
      // The caller's reason survives rather than being flattened away.
      assert.equal(error.message, 'user navigated away')
    },
  )
})

test('only identity and PostgREST reads are bounded', async () => {
  const boundedFetch = createSupabaseReadTimeoutFetch(SUPABASE_URL, 10)
  await withFetch(
    () => new Promise((resolve) => { setTimeout(() => resolve('slow-but-allowed'), 40) }),
    async () => {
      // A write must not inherit the read deadline.
      assert.equal(await boundedFetch(READ_URL, { method: 'POST' }), 'slow-but-allowed')
      // Neither must a non-Supabase origin.
      assert.equal(await boundedFetch('https://tcnp.vercel.app/api/health'), 'slow-but-allowed')
    },
  )
})

test('a plain Supabase rejection is titled by what actually failed', () => {
  // Supabase returns { code, details, hint, message }, so every failure —
  // timeout, permission denial, bad query — collapsed into a single issue
  // called "Object captured as exception with keys: ...".
  const event = {
    exception: { values: [{ value: 'Object captured as exception with keys: code, details, hint, message' }] },
    extra: { __serialized__: { code: '', details: 'AbortError: ...', hint: '', message: 'permission denied for table programs' } },
  }
  retitleSerializedException(event)
  assert.equal(event.exception.values[0].value, 'permission denied for table programs')
})

test('retitling leaves real Errors and empty payloads alone', () => {
  const real = { exception: { values: [{ value: 'TypeError: x is not a function' }] }, extra: {} }
  retitleSerializedException(real)
  assert.equal(real.exception.values[0].value, 'TypeError: x is not a function')

  const blank = {
    exception: { values: [{ value: 'Object captured as exception with keys: code' }] },
    extra: { __serialized__: { message: '   ' } },
  }
  retitleSerializedException(blank)
  assert.equal(blank.exception.values[0].value, 'Object captured as exception with keys: code')

  assert.doesNotThrow(() => retitleSerializedException({}))
})

test('noise the ignore list names is matched once the real message is visible', () => {
  // The whole point of retitling: ignoreErrors tests the exception value, so
  // against the old generic title these patterns could never match.
  assert.equal(matchesIgnoredError('AbortError: signal is aborted without reason'), true)
  assert.equal(matchesIgnoredError('ResizeObserver loop limit exceeded'), true)
  assert.equal(matchesIgnoredError('NEXT_REDIRECT;replace;/login;307;'), true)
  // A genuine timeout must survive the filter — it is the signal, not the noise.
  assert.equal(
    matchesIgnoredError('TCNP_SUPABASE_REQUEST_TIMEOUT: Supabase did not respond within 15000ms.'),
    false,
  )
})
