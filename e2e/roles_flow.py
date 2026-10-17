"""Browser test of the role model and the new sign-in (web app), with a screenshot of every new screen.

Local (backend on :4000 without Brevo, writing its log to a file; web build on :8081):
    python e2e/roles_flow.py --api http://localhost:4000 --codes log:backend.log --root root@e2e.test --shots shots
Live (real Brevo email to throw-away mail.tm inboxes owned by the run):
    python e2e/roles_flow.py --base https://laalpen.vercel.app --api https://laalpen-backend.onrender.com --codes mailtm --root <a SUPER_ADMIN on a mail.tm inbox>

Journey: login choice (EN/UR) → super admin signs in with an emailed code → adds a school + principal (invite email) →
principal signs in with the code → completes the school profile → adds a teacher (invite) → teacher completes the
profile → "waiting for principal approval" (blocked from student data) → principal approves → teacher sees classes →
staff password sign-in is refused → teacher adds a passkey and signs in with it → parent / student signs up, verifies
the email, adds a child with the class code + name + roll + date of birth, signs in again with the mobile number →
Urdu → super admin pauses the school (no codes are sent to its staff) and restores it.
"""
import argparse
import base64
import hashlib
import hmac
import json
import re
import struct
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from inbox import LogCodes, MailTm  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8081')
ap.add_argument('--api', default='http://localhost:4000')
ap.add_argument('--codes', required=True, help='log:<backend log file> or mailtm')
ap.add_argument('--root', required=True, help='email of an existing SUPER_ADMIN whose codes this run can read')
ap.add_argument('--root-inbox', default='', help='mailtm: "address:password" of the super admin inbox')
ap.add_argument('--child', default='ALN-10A|Talha Mirza|05|26/04/2011', help='class code|child name|roll|DOB of a roster child')
ap.add_argument('--shots', default='shots')
ap.add_argument('--results', default='roles_results.json')
a = ap.parse_args()
B, API = a.base.rstrip('/'), a.api.rstrip('/')
Path(a.shots).mkdir(parents=True, exist_ok=True)
tag = uuid.uuid4().hex[:6]
codes = LogCodes(a.codes[4:]) if a.codes.startswith('log:') else MailTm()
if isinstance(codes, MailTm) and a.root_inbox:
    addr, pw = a.root_inbox.split(':', 1)
    tok = codes._req('POST', '/token', {'address': addr, 'password': pw})['token']
    codes.accounts[addr] = {'password': pw, 'token': tok}
    codes.seen[addr] = set()
PRINCIPAL = codes.new_address(f'principal-{tag}')
TEACHER = codes.new_address(f'teacher-{tag}')
FAMILY = codes.new_address(f'family-{tag}')
PHONE = f'0333{int(tag, 16) % 10_000_000:07d}'
SCHOOL = f'Roles Test School {tag}'
results: list[dict] = []
state: dict = {'tag': tag, 'principal': PRINCIPAL, 'teacher': TEACHER, 'family': FAMILY, 'phone': PHONE, 'school': SCHOOL}


def step(name, ok=True, detail=''):
    results.append({'step': name, 'ok': ok, 'detail': detail})
    print(('✓ ' if ok else '✗ ') + name + (f' — {detail}' if detail else ''), flush=True)


def save():
    Path(a.results).write_text(json.dumps({'state': state, 'results': results}, indent=2))


def api(method, path, body=None, token=None):
    r = urllib.request.Request(API + '/api' + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(r, timeout=90) as res:
            return res.status, json.loads(res.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'null')
        except Exception:
            return e.code, None


def totp(secret_b32: str) -> str:
    s = secret_b32.replace(' ', '').upper()
    key = base64.b32decode(s + '=' * (-len(s) % 8))
    h = hmac.new(key, struct.pack('>Q', int(time.time() // 30)), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f'{(struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}'


def tid(page, t):
    return page.get_by_test_id(t).locator('visible=true').first


def btn(page, name):
    return page.get_by_role('button', name=re.compile(re.escape(name))).locator('visible=true').last


def field(page, label):
    return page.locator(f'input[aria-label="{label}"], textarea[aria-label="{label}"]').locator('visible=true').first


def text(page, t):
    return page.get_by_text(t).locator('visible=true').first


def shot(page, name):
    page.wait_for_timeout(1300)
    page.screenshot(path=f'{a.shots}/{name}.png', full_page=True)


def logout(page):
    page.evaluate("() => { try { localStorage.removeItem('laalpen.session'); } catch (e) {} }")
    page.goto(B + '/login')
    page.wait_for_timeout(800)


def maybe_totp(page, who):
    """Principals may have to set up the authenticator app first (REQUIRE_ADMIN_2FA)."""
    page.wait_for_timeout(2500)
    if '/security/two-factor' not in page.url:
        return
    btn(page, 'Show my QR code').click()
    secret = page.get_by_text(re.compile(r'^[A-Z2-7]{4}( [A-Z2-7]{4})+$')).locator('visible=true').first.inner_text()
    state[f'{who}_totp'] = secret
    field(page, '6-digit code').fill(totp(secret))
    btn(page, 'Turn on two-step sign-in').click()
    expect(text(page, 'Save your backup codes')).to_be_visible(timeout=15000)
    btn(page, 'I saved them').click()
    page.wait_for_timeout(1500)
    step(f'{who}: authenticator app set up (REQUIRE_ADMIN_2FA)')


def staff_login(page, email, who, shot_name=None):
    page.goto(f'{B}/login?staff=1&email={email}')
    expect(tid(page, 'send-code')).to_be_visible(timeout=60000)
    codes.mark(email)
    tid(page, 'send-code').click()
    page.wait_for_url('**/email-code**', timeout=60000)
    if shot_name:
        shot(page, shot_name)
    code = codes.code(email, 'sign-in code')
    tid(page, 'email-code').fill(code)
    page.wait_for_url(lambda u: '/email-code' not in u, timeout=60000)
    page.wait_for_timeout(1500)
    if who in ('principal',) and state.get('principal_totp') and '/two-step' in page.url:
        field(page, '6-digit code').fill(totp(state['principal_totp']))
        btn(page, 'Sign in').click()
        page.wait_for_timeout(2500)
    maybe_totp(page, who)


def run(page):
    # ---- login screen ----
    page.goto(B + '/login')
    expect(tid(page, 'pick-staff')).to_be_visible(timeout=90000)
    shot(page, '01-login-choice')
    page.get_by_label('اردو میں دیکھیں').locator('visible=true').first.click()
    page.wait_for_timeout(1200)
    shot(page, '02-login-choice-urdu')
    page.get_by_label('Switch to English').locator('visible=true').first.click()
    tid(page, 'pick-staff').click()
    shot(page, '03-login-staff')
    page.goto(B + '/login?mode=family')
    expect(tid(page, 'family-id')).to_be_visible(timeout=20000)
    shot(page, '04-login-family')
    step('login screen: big Staff vs Parent / Student choice, Urdu, no password field for staff')

    # ---- super admin ----
    staff_login(page, a.root, 'root', '05-email-code')
    expect(page).to_have_url(re.compile(r'/platform'), timeout=30000)
    shot(page, '06-platform-schools')
    step('super admin signed in with an emailed code and landed on Schools')
    tid(page, 'add-school').click()
    field(page, 'School name *').fill(SCHOOL)
    field(page, 'City').fill('Lahore')
    field(page, 'Principal’s full name *').fill('Nadia Principal')
    field(page, 'Principal’s email *').fill(PRINCIPAL)
    codes.mark(PRINCIPAL)
    shot(page, '07-platform-add-school')
    btn(page, 'Add school and invite principal').click()
    expect(text(page, SCHOOL)).to_be_visible(timeout=30000)
    subj = codes.wait_new(PRINCIPAL, 'principal')['subject'] if isinstance(codes, MailTm) else (codes.subjects(PRINCIPAL) or [''])[-1]
    step('super admin added a school + principal; invite email delivered', True, subj)
    text(page, SCHOOL).click()
    page.wait_for_url('**/platform/school/**')
    state['school_id'] = page.url.rstrip('/').split('/')[-1]
    shot(page, '08-platform-school-detail')
    logout(page)

    # ---- principal ----
    staff_login(page, PRINCIPAL, 'principal')
    expect(page).to_have_url(re.compile(r'/school-setup'), timeout=30000)
    shot(page, '09-school-setup')
    st, body = api('GET', '/admin/dashboard', token=page.evaluate("() => JSON.parse(localStorage.getItem('laalpen.session')).accessToken"))
    step('principal must finish the school profile first', st == 403 and (body or {}).get('code') in ('SCHOOL_PROFILE_REQUIRED', 'MFA_SETUP_REQUIRED'), f'{st} {(body or {}).get("code")}')
    tid(page, 'sch-address').fill('12 Mall Road, Gulberg')
    tid(page, 'sch-city').fill('Lahore')
    tid(page, 'sch-phone').fill('042 35761234')
    tid(page, 'cls-name-0').fill('Class 9')
    tid(page, 'cls-sec-0').fill('A, B')
    tid(page, 'sch-subjects').fill('Physics, Mathematics')
    tid(page, 'sch-save').click()
    page.wait_for_url('**/admin/teachers', timeout=30000)
    step('principal completed the school profile (address, phone, classes 9-A/9-B, subjects)')
    btn(page, 'Add teacher').click()
    field(page, 'Full name *').fill('Umar Teacher')
    field(page, 'Email *').fill(TEACHER)
    codes.mark(TEACHER)
    shot(page, '10-add-teacher-no-password')
    btn(page, 'Add teacher').click()
    expect(text(page, 'Umar Teacher')).to_be_visible(timeout=20000)
    subj = codes.wait_new(TEACHER, 'teacher')['subject'] if isinstance(codes, MailTm) else (codes.subjects(TEACHER) or [''])[-1]
    shot(page, '11-teachers-invited')
    step('principal added a teacher (no password field); invite email delivered', True, subj)
    logout(page)

    # ---- teacher ----
    staff_login(page, TEACHER, 'teacher')
    expect(page).to_have_url(re.compile(r'/teacher-setup'), timeout=30000)
    shot(page, '12-teacher-profile-form')
    tok = page.evaluate("() => JSON.parse(localStorage.getItem('laalpen.session')).accessToken")
    st, body = api('GET', '/teacher/classes', token=tok)
    step('new teacher is blocked from student data', st == 403 and (body or {}).get('code') == 'TEACHER_APPROVAL_REQUIRED', f'{st} {(body or {}).get("code")}')
    tid(page, 'tp-name').fill('Umar Farooq')
    tid(page, 'tp-phone').fill('0300 1234567')
    tid(page, 'tp-qual').fill('MSc Physics, B.Ed')
    tid(page, 'tp-subjects').fill('Physics')
    tid(page, 'tp-sec-0').click()
    page.get_by_role('menuitem', name='9-A').locator('visible=true').first.click()
    tid(page, 'tp-subj-0').fill('Physics')
    codes.mark(PRINCIPAL)
    tid(page, 'tp-submit').click()
    expect(text(page, 'Waiting for principal approval')).to_be_visible(timeout=20000)
    shot(page, '13-teacher-waiting')
    step('teacher completed the profile and sees "waiting for principal approval"')
    logout(page)

    # ---- principal approves ----
    staff_login(page, PRINCIPAL, 'principal')
    page.goto(B + '/admin/teachers')
    expect(text(page, 'Waiting for your approval')).to_be_visible(timeout=30000)
    shot(page, '14-principal-approval')
    codes.mark(TEACHER)
    page.locator('[data-testid^="approve-"]').locator('visible=true').first.click()
    expect(page.locator('[data-testid^="approve-"]')).to_have_count(0, timeout=20000)
    subj = codes.wait_new(TEACHER, 'approved')['subject'] if isinstance(codes, MailTm) else (codes.subjects(TEACHER) or [''])[-1]
    step('principal approved the teacher; approval email delivered', True, subj)
    logout(page)

    # ---- teacher now works; staff passwords refused; passkey ----
    staff_login(page, TEACHER, 'teacher')
    expect(page).to_have_url(re.compile(r'/teacher'), timeout=30000)
    shot(page, '15-teacher-approved-home')
    step('approved teacher opens the teacher home')
    st, body = api('POST', '/auth/login', {'email': TEACHER, 'password': 'Any-Password-123'})
    step('staff password sign-in refused', st == 403 and (body or {}).get('code') == 'STAFF_USE_EMAIL_CODE', f'{st} {(body or {}).get("code")}')
    try:
        cdp = page.context.new_cdp_session(page)
        cdp.send('WebAuthn.enable')
        cdp.send('WebAuthn.addVirtualAuthenticator', {'options': {'protocol': 'ctap2', 'transport': 'internal', 'hasResidentKey': True, 'hasUserVerification': True, 'isUserVerified': True}})
        page.goto(B + '/profile')
        btn(page, 'Add a passkey').click()
        expect(text(page, 'Passkey added')).to_be_visible(timeout=20000)
        shot(page, '16-profile-passkey-staff')
        logout(page)
        page.goto(f'{B}/login?staff=1&email={TEACHER}')
        btn(page, 'Sign in with a passkey').click()
        page.wait_for_url(re.compile(r'/teacher'), timeout=30000)
        step('teacher added a passkey and signed in with it')
    except Exception as e:  # noqa: BLE001
        step('passkey (virtual authenticator)', False, str(e)[:200])
    logout(page)

    # ---- parent / student ----
    page.goto(B + '/register')
    expect(tid(page, 'su-name')).to_be_visible(timeout=30000)
    shot(page, '17-signup-parent-student')
    tid(page, 'su-name').fill('Ammi Jaan')
    tid(page, 'su-email').fill(FAMILY)
    tid(page, 'su-phone').fill(PHONE)
    tid(page, 'su-password').fill('Family-Mango-42')
    codes.mark(FAMILY)
    tid(page, 'su-submit').click()
    page.wait_for_url('**/verify**', timeout=60000)
    shot(page, '18-verify-email')
    field(page, 'Verification code').fill(codes.code(FAMILY, 'verification'))
    btn(page, 'Verify email').click()
    page.wait_for_url(re.compile(r'/parent'), timeout=30000)
    shot(page, '19-parent-home-empty')
    step('parent / student signed up and verified the email with the Brevo code')
    class_code, child, roll, dob = a.child.split('|')
    tid(page, 'add-child').click()
    tid(page, 'link-code').fill(class_code)
    tid(page, 'link-check').click()
    expect(tid(page, 'link-name')).to_be_visible(timeout=20000)
    tid(page, 'link-name').fill(child)
    tid(page, 'link-roll').fill(roll)
    tid(page, 'link-dob').fill(dob)
    shot(page, '20-add-child-class-code')
    tid(page, 'link-submit').click()
    page.wait_for_timeout(3000)
    page.reload()
    expect(text(page, child.split(' ')[0])).to_be_visible(timeout=30000)
    shot(page, '21-parent-home-child')
    step('child linked from the one code box (class code + name + roll + DOB → automatic)')
    logout(page)
    page.goto(B + '/login?mode=family')
    tid(page, 'family-id').fill(PHONE)
    tid(page, 'family-password').fill('Family-Mango-42')
    tid(page, 'family-login').click()
    page.wait_for_url(re.compile(r'/parent'), timeout=30000)
    step('parent / student signed in with the mobile number + password')
    page.get_by_label('اردو میں دیکھیں').locator('visible=true').first.click()
    page.wait_for_timeout(1500)
    shot(page, '22-parent-home-urdu')
    page.get_by_label('Switch to English').locator('visible=true').first.click()
    logout(page)

    # ---- super admin pauses + restores the school ----
    staff_login(page, a.root, 'root')
    page.goto(f"{B}/platform/school/{state['school_id']}")
    tid(page, 'suspend-school').click()
    field(page, 'Reason (kept in the log) *').fill('e2e pause test')
    btn(page, 'Pause school').click()
    expect(text(page, 'Restore school')).to_be_visible(timeout=20000)
    shot(page, '23-platform-school-paused')
    codes.mark(PRINCIPAL)
    st, _ = api('POST', '/auth/email-code/start', {'email': PRINCIPAL})
    time.sleep(25 if isinstance(codes, MailTm) else 4)
    got = [s for s in codes.subjects(PRINCIPAL) if 'sign-in code' in s]
    step('paused school: staff get no sign-in code (same answer on screen)', st == 200 and not got, f'{st}, codes received: {len(got)}')
    btn(page, 'Restore school').click()
    page.wait_for_timeout(800)
    page.get_by_role('button', name='Restore', exact=True).locator('visible=true').first.click()
    expect(tid(page, 'suspend-school')).to_be_visible(timeout=20000)
    step('super admin restored the school')


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900})
    page = ctx.new_page()
    try:
        run(page)
    except Exception as e:  # noqa: BLE001
        step('run stopped', False, f'{type(e).__name__}: {str(e)[:300]}')
        try:
            page.screenshot(path=f'{a.shots}/zz-failure.png', full_page=True)
        except Exception:
            pass
    finally:
        save()
        browser.close()
ok = all(r['ok'] for r in results)
print(f"{sum(r['ok'] for r in results)}/{len(results)} steps passed")
sys.exit(0 if ok else 1)
