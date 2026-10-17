"""Where the e2e scripts read the emailed codes from.

* LogCodes: the local backend without Brevo prints every email as `[console email] to=… subject="…" code=123456`.
* MailTm: real delivery for live tests: throw-away inboxes on mail.tm (https://docs.mail.tm), owned by the test run.
"""
import json
import re
import secrets
import time
import urllib.request
from pathlib import Path


class LogCodes:
    def __init__(self, path: str):
        self.path = Path(path)
        self.marks: dict[str, int] = {}

    def new_address(self, tag: str) -> str:
        return f'{tag}@e2e.test'

    def mark(self, email: str):
        self.marks[email] = len(self.path.read_text(errors='ignore'))

    def code(self, email: str, subject_hint: str = '', timeout=40) -> str:
        start = self.marks.get(email, 0)
        end = time.time() + timeout
        while time.time() < end:
            text = self.path.read_text(errors='ignore')[start:]
            m = [c for s, c in re.findall(rf'to={re.escape(email)} subject="([^"]*)" code=(\d{{6}})', text) if subject_hint.lower() in s.lower()]
            if m:
                self.marks[email] = len(self.path.read_text(errors='ignore'))
                return m[-1]
            time.sleep(0.5)
        raise RuntimeError(f'no code for {email} ({subject_hint}) in {self.path}')

    def subjects(self, email: str) -> list[str]:
        start = self.marks.get(email, 0)
        return re.findall(rf'to={re.escape(email)} subject="([^"]*)"', self.path.read_text(errors='ignore')[start:])


class MailTm:
    API = 'https://api.mail.tm'

    def __init__(self):
        self.accounts: dict[str, dict] = {}
        self.seen: dict[str, set] = {}
        self._domain = None

    def _req(self, method, path, body=None, token=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.API + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Accept': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(r, timeout=30) as res:
                    raw = res.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(2 + attempt * 2)
                    continue
                raise RuntimeError(f'mail.tm {method} {path}: {e.code} {e.read()[:200]!r}')
        raise RuntimeError('mail.tm rate limit')

    def domain(self):
        if not self._domain:
            d = self._req('GET', '/domains')
            items = d['hydra:member'] if isinstance(d, dict) else d
            self._domain = items[0]['domain']
        return self._domain

    def new_address(self, tag: str) -> str:
        addr = f'lp-{tag}-{secrets.token_hex(3)}@{self.domain()}'
        pw = secrets.token_urlsafe(16)
        self._req('POST', '/accounts', {'address': addr, 'password': pw})
        tok = self._req('POST', '/token', {'address': addr, 'password': pw})['token']
        self.accounts[addr] = {'password': pw, 'token': tok}
        self.seen[addr] = set()
        return addr

    def mark(self, email: str):
        self.seen[email] = {m['id'] for m in self.messages(email)}

    def messages(self, email: str):
        d = self._req('GET', '/messages', token=self.accounts[email]['token'])
        return d['hydra:member'] if isinstance(d, dict) else d

    def wait_new(self, email: str, subject_hint: str = '', timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            for m in self.messages(email):
                if m['id'] in self.seen[email]:
                    continue
                if subject_hint.lower() in (m.get('subject') or '').lower():
                    self.seen[email].add(m['id'])
                    return m
            time.sleep(3)
        raise RuntimeError(f'no new email for {email} ({subject_hint}) within {timeout}s')

    def code(self, email: str, subject_hint: str = '', timeout=120) -> str:
        m = self.wait_new(email, subject_hint, timeout)
        c = re.search(r'\b(\d{6})\b', m.get('subject') or '')
        if c:
            return c.group(1)
        full = self._req('GET', f"/messages/{m['id']}", token=self.accounts[email]['token'])
        return re.search(r'\b(\d{6})\b', full.get('text') or '').group(1)

    def subjects(self, email: str) -> list[str]:
        return [m.get('subject') or '' for m in self.messages(email) if m['id'] not in self.seen[email]]

    def body(self, email: str, subject_hint: str) -> str:
        for m in self.messages(email):
            if subject_hint.lower() in (m.get('subject') or '').lower():
                full = self._req('GET', f"/messages/{m['id']}", token=self.accounts[email]['token'])
                return (full.get('text') or '') + '\n' + ''.join(full.get('html') or [])
        return ''

    def cleanup(self):
        for addr, a in self.accounts.items():
            try:
                me = self._req('GET', '/me', token=a['token'])
                self._req('DELETE', f"/accounts/{me['id']}", token=a['token'])
            except Exception:
                pass
