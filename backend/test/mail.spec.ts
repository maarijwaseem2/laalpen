import { describe, expect, it } from 'vitest';
import { undeliverable } from '../src/mail/mail.service.js';

describe('mail', () => {
  it('never sends real mail to demo or reserved test domains', () => {
    for (const e of ['admin@laalpen.demo', 'a@roster.test', 'x@example.com', 'y@mail.example.org', 'z@foo.invalid']) expect(undeliverable(e)).toBe(true);
    for (const e of ['maarijwaseem7@gmail.com', 'teacher@school.edu.pk', 'someone@demo.pk', 'a@testing.com']) expect(undeliverable(e)).toBe(false);
  });
});
