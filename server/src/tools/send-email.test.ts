import { describe, expect, it } from 'vitest';
import { sendEmail } from './send-email';
import { errorText, fakeContentStrapi, runTool, structured } from './test-support';

const ARGS = { to: 'a@example.com', subject: 'Hi', html: '<p>Hello</p>', replyTo: 'me@example.com' };

describe('send_email', () => {
  it('sends through the email plugin with exactly the fields given', async () => {
    const { strapi, calls } = fakeContentStrapi();
    const result = await runTool(sendEmail, strapi, ARGS);
    expect(calls.find((call) => call.op === 'email')?.params).toEqual(ARGS);
    expect(structured(result)).toEqual({ sent: true, to: 'a@example.com', subject: 'Hi' });
  });

  it('reports a provider failure as an error the model can relay, with the domain hint', async () => {
    const { strapi } = fakeContentStrapi({ emailFails: 'You can only send testing emails to your own address' });
    const result = await runTool(sendEmail, strapi, ARGS);
    expect(result).toMatchObject({ isError: true });
    expect(errorText(result)).toMatch(/verif/i);
  });

  it('says plainly when no email plugin is installed', async () => {
    const { strapi } = fakeContentStrapi({ noEmailPlugin: true });
    const result = await runTool(sendEmail, strapi, ARGS);
    expect(errorText(result)).toMatch(/email plugin/i);
  });

  it('tells the model to confirm the recipient before calling', () => {
    expect(sendEmail.description).toMatch(/confirm/i);
  });
});
