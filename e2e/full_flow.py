"""Browser test of the whole LaalPen journey on the web app (production security settings).

Needs: backend on :4000 writing its log to a file (codes are printed there while Brevo/SMS are off),
ai-service on :8000 and the web build served on :8081. See README "Browser test". Usage:
    python e2e/full_flow.py --api-log backend.log --copy backend/prisma/seed-assets/mixed-page-1.jpg

Steps: school sign-up → email code → mandatory authenticator app (TOTP) → classes/subject/teacher →
Excel/CSV register import → teacher sign-in → class code → student joins with roll + date of birth and is
linked at once → answer key confirmed → copy uploaded and checked → mark changed, approved, published →
parent signs in with the mobile number → student sees the red-pen copy → Urdu → principal insights → dark mode.
"""
import argparse
import base64
import hashlib
import hmac
import re
import struct
import tempfile
import time
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8081')
ap.add_argument('--api-log', required=True, help='backend log file (codes are printed there while Brevo/SMS are off)')
ap.add_argument('--copy', required=True, help='photo of an answer page to upload')
ap.add_argument('--shots', default='.', help='folder for screenshots')
a = ap.parse_args()
B = a.base
tag = uuid.uuid4().hex[:6]
ADMIN, TEACHER, STUDENT = f'owner-{tag}@e2e.test', f'teacher-{tag}@e2e.test', f'student-{tag}@e2e.test'
PHONE = f'0300{int(tag, 16) % 10_000_000:07d}'
PHONE_E164 = '+92' + PHONE[1:]
steps: list[str] = []


def step(msg):
    steps.append(msg)
    print('✓', msg, flush=True)


def log_code(pattern: str, what: str):
    for _ in range(60):
        m = re.findall(pattern, Path(a.api_log).read_text(errors='ignore'))
        if m:
            return m[-1]
        time.sleep(0.5)
    raise RuntimeError(f'no code for {what} in {a.api_log}')


def otp_for(email):
    return log_code(rf'to={re.escape(email)} subject="[^"]*" code=(\d{{6}})', email)


def sms_code(phone_e164):
    return log_code(rf'\[console sms\] to={re.escape(phone_e164)} code=(\d{{6}})', phone_e164)


def totp(secret_b32: str, at: float | None = None) -> str:
    key = base64.b32decode(secret_b32.replace(' ', '').upper() + '=' * (-len(secret_b32.replace(' ', '')) % 8))
    counter = int((at or time.time()) // 30)
    h = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f'{(struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}'


def text(page, t):
    return page.locator(f'text={t} >> visible=true').first


def btn(page, name):
    return page.get_by_role('button', name=re.compile(re.escape(name))).locator('visible=true').last


def field(page, label):
    return page.locator(f'input[aria-label="{label}"], textarea[aria-label="{label}"]').locator('visible=true').first


def fill(page, values: dict):
    for label, value in values.items():
        field(page, label).fill(value)


def choose(page, label, option):
    page.wait_for_timeout(700)
    btn(page, f"{label.rstrip(' *')}:").click()
    page.wait_for_timeout(400)
    page.get_by_role('menuitem', name=option).locator('visible=true').last.click()


def shot(page, name):
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{a.shots}/{name}.png', full_page=True)


def login(page, email, password):
    page.goto(B + '/login')
    field(page, 'Email').fill(email)
    page.get_by_role('textbox', name='Password').fill(password)
    btn(page, 'Log in').click()
    page.wait_for_timeout(2500)


def logout(page):
    page.goto(B + '/profile')
    page.get_by_text('Log out', exact=True).locator('visible=true').first.click()
    page.wait_for_url('**/login')


def run(page):
    # 1. register a school, verify the email with the 6-digit code
    page.goto(B + '/register')
    page.get_by_role('button', name='New school').locator('visible=true').first.click()
    fill(page, {'School name *': f'E2E School {tag}', 'City': 'Karachi', 'Your name *': 'Owner Sahab', 'Email *': ADMIN, 'Password *': 'Owner-Mango-4242'})
    btn(page, 'Create school account').click()
    page.wait_for_url('**/verify**')
    fill(page, {'Verification code': otp_for(ADMIN)})
    btn(page, 'Verify email').click()
    step('school registered, email verified with the code')

    # 2. principals must turn on the authenticator app before seeing school data
    expect(text(page, 'Protect your account')).to_be_visible(timeout=15000)
    page.goto(B + '/admin/students')
    expect(text(page, 'Protect your account')).to_be_visible(timeout=10000)  # cannot skip it
    btn(page, 'Show my QR code').click()
    secret = page.get_by_text(re.compile(r'^[A-Z2-7]{4}( [A-Z2-7]{4})+$')).locator('visible=true').first.inner_text()
    fill(page, {'6-digit code': totp(secret)})
    btn(page, 'Turn on two-step sign-in').click()
    expect(text(page, 'Save your backup codes')).to_be_visible(timeout=10000)
    btn(page, 'I saved them').click()
    step('admin was made to set up the authenticator app (TOTP) and got backup codes')

    # 3. admin sets up the school
    page.goto(B + '/admin/subjects')
    btn(page, 'Add subject').click()
    fill(page, {'Subject name *': 'Physics'})
    btn(page, 'Add subject').click()
    expect(text(page, 'taught in 0 sections')).to_be_visible()
    page.goto(B + '/admin/classes')
    btn(page, 'Add class').click()
    fill(page, {'Class name *': 'Class 9', 'Grade number *': '9', 'Sections': 'A, B'})
    btn(page, 'Add class').click()
    expect(text(page, '0 students')).to_be_visible()
    page.goto(B + '/admin/teachers')
    btn(page, 'Add teacher').click()
    fill(page, {'Full name *': 'Sana Teacher', 'Email *': TEACHER, 'Password': 'Teacher-Mango-424'})
    btn(page, 'Add teacher').click()
    btn(page, 'Assign a class').click()
    choose(page, 'Class and section *', 'Class 9 A')
    choose(page, 'Subject *', 'Physics')
    btn(page, 'Assign').click()
    expect(text(page, 'Physics — Class 9 A')).to_be_visible()
    step('admin added a subject, a class with two sections and a teacher with an assignment')

    # 4. the register comes in from Excel/CSV: dry run first, then save
    csv = Path(tempfile.gettempdir()) / f'register-{tag}.csv'
    csv.write_text('GR No,Student Name,Father Name,Class,Section,Roll No,DOB,Father Mobile\n'
                   f'E-{tag}-1,Ali Student,Raza Khan,9,A,01,05/03/2012,{PHONE}\n'
                   f'E-{tag}-2,Sara Student,Iqbal Ahmed,9,A,02,11/08/2012,0301 1112233\n'
                   f'E-{tag}-3,Bad Date,Some One,9,A,03,31/02/2012,\n')
    page.goto(B + '/admin/import')
    with page.expect_file_chooser() as fc:
        btn(page, 'Choose file').click()
    fc.value.set_files(str(csv))
    expect(text(page, 'Fix these in Excel (1)')).to_be_visible(timeout=15000)
    btn(page, '2. Save 2 students').click()
    page.wait_for_url('**/admin/students', timeout=15000)
    expect(text(page, 'Ali Student')).to_be_visible()
    shot(page, 'e2e-admin-students')
    step('register imported from CSV: 2 students saved, the row with a wrong date was flagged')
    logout(page)

    # 5. teacher signs in and shares the class code
    login(page, TEACHER, 'Teacher-Mango-424')
    page.goto(B + '/teacher/classes')
    text(page, '9-A').click()
    page.wait_for_url('**/teacher/assignment/**')
    page.get_by_role('button', name=re.compile('Students')).locator('visible=true').first.click()
    code = page.get_by_text(re.compile(r'^[A-Z0-9]{2,5}-[A-Z0-9]{6}$')).locator('visible=true').first.inner_text()
    step(f'teacher opened the class; class code is {code}')
    logout(page)

    # 6. student joins with the class code, roll number and date of birth → linked at once (no waiting)
    page.goto(B + '/register')
    fill(page, {'Class code': code})
    btn(page, 'Find my class').click()
    expect(text(page, f'E2E School {tag}')).to_be_visible()
    fill(page, {'Roll number *': '01', 'Your full name *': 'Ali Student', 'Date of birth': '05/03/2012', 'Email *': STUDENT, 'Password *': 'Student-Mango-424'})
    btn(page, 'Create my account').click()
    page.wait_for_url('**/verify**')
    fill(page, {'Verification code': otp_for(STUDENT)})
    btn(page, 'Verify email').click()
    expect(text(page, 'Checked tests')).to_be_visible(timeout=15000)
    step('student joined with class code + roll + date of birth and was linked to the register automatically')
    logout(page)

    # 7. teacher: test, answer key, copy, AI check, review, approve, publish
    login(page, TEACHER, 'Teacher-Mango-424')
    page.goto(B + '/teacher/classes')
    text(page, '9-A').click()
    btn(page, 'Create the first test').click()
    fill(page, {'Title *': 'E2E Unit Test'})
    qs = [('Define speed and its SI unit', '5', 'distance per unit time, m/s'), ('150 m in 12 s, find speed', '5', 'v = s/t = 12.5 m/s')]
    for i, (q, m, k) in enumerate(qs):
        page.locator('[aria-label="Question *"]').locator('visible=true').nth(i).fill(q)
        page.locator('[aria-label="Marks *"]').locator('visible=true').nth(i).fill(m)
        page.locator('[aria-label="Answer key *"]').locator('visible=true').nth(i).fill(k)
    btn(page, 'Create test').click()
    page.wait_for_url('**/teacher/key/**')
    btn(page, 'Confirm answer key').click()
    page.wait_for_url('**/teacher/test/**', timeout=20000)
    with page.expect_file_chooser() as fc:
        page.get_by_role('button', name='Upload pages').locator('visible=true').first.click()  # roll 01: Ali
    fc.value.set_files(a.copy)
    btn(page, 'Send for checking').click()
    expect(text(page, 'Ready to approve').or_(text(page, 'Needs review'))).to_be_visible(timeout=90000)
    shot(page, 'e2e-teacher-test')
    step('teacher confirmed the answer key, uploaded a copy, AI checked it in the background')
    text(page, 'Ali Student').click()
    page.wait_for_url('**/teacher/submission/**')
    page.get_by_role('button', name='4.5 marks', exact=True).locator('visible=true').first.click()  # Q1: 5 → 4.5
    page.get_by_text('Too lenient', exact=True).locator('visible=true').first.click()
    btn(page, 'Save change').click()
    page.wait_for_timeout(1500)
    btn(page, 'Approve').click()
    page.wait_for_timeout(2500)
    page.go_back()
    page.wait_for_timeout(1500)
    btn(page, 'Publish results').click()
    expect(text(page, 'Results out')).to_be_visible(timeout=10000)
    step('teacher changed a mark, approved and published')
    logout(page)

    # 8. parent signs in with the mobile number the school has
    page.goto(B + '/parent-login')
    fill(page, {'Mobile number': PHONE})
    btn(page, 'Send code').click()
    fill(page, {'6-digit code': sms_code(PHONE_E164)})
    btn(page, 'Open my children’s results').click()
    expect(text(page, 'E2E Unit Test')).to_be_visible(timeout=15000)
    shot(page, 'e2e-parent-home')
    step('parent signed in with the phone number (SMS/WhatsApp code) and sees the child’s result')
    logout(page)

    # 9. student sees the red-pen copy; Urdu; dark mode
    login(page, STUDENT, 'Student-Mango-424')
    text(page, 'E2E Unit Test').click()
    expect(text(page, 'Checked copy')).to_be_visible(timeout=10000)
    shot(page, 'e2e-student-result')
    page.goto(B + '/notifications')
    expect(text(page, 'Result: E2E Unit Test')).to_be_visible()
    step('student opened the result with the checked copy; result notification arrived')
    page.goto(B + '/student')
    page.get_by_role('button', name='اردو میں دیکھیں').locator('visible=true').first.click()
    expect(text(page, 'حالیہ نتائج')).to_be_visible(timeout=5000)
    shot(page, 'e2e-student-urdu')
    page.get_by_role('button', name='Switch to English').locator('visible=true').first.click()
    page.get_by_role('button', name='Switch to dark mode').locator('visible=true').first.click()
    page.goto(B + '/student')
    expect(page.get_by_role('button', name='Switch to light mode').locator('visible=true').first).to_be_visible()
    shot(page, 'e2e-dark')
    page.get_by_role('button', name='Switch to light mode').locator('visible=true').first.click()
    step('Urdu (right-to-left) and dark mode switch on and are remembered')
    logout(page)

    # 10. principal: sign-in needs the authenticator code; insights show the published test
    login(page, ADMIN, 'Owner-Mango-4242')
    secret_code = totp(SECRET[0]) if SECRET else None
    page.wait_for_url('**/two-step**', timeout=10000)
    fill(page, {'6-digit code': secret_code})
    btn(page, 'Sign in').click()
    page.wait_for_timeout(2500)
    page.goto(B + '/admin/insights')
    expect(text(page, 'Lowest-scoring topics')).to_be_visible(timeout=15000)
    shot(page, 'e2e-admin-insights')
    step('principal signed in with password + authenticator code and opened insights')


SECRET: list[str] = []
_orig_totp = totp


def totp(secret_b32: str, at: float | None = None) -> str:  # noqa: F811 — remember the secret for the later sign-in
    if not SECRET:
        SECRET.append(secret_b32)
    return _orig_totp(secret_b32, at)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1366, 'height': 900})
    errors: list[str] = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    try:
        run(page)
    except Exception:
        page.screenshot(path=f'{a.shots}/e2e-failed.png', full_page=True)
        raise
    finally:
        browser.close()
    assert not errors, errors
print(f'\nALL {len(steps)} STEPS PASSED')
