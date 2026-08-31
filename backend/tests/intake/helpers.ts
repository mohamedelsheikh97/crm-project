import { buildInboundEmail, type SimulatedEmail } from '../../src/channels/email/simulator.js';
import { normaliseContact } from '../../src/lib/phone.js';
import { Customer, CustomerContact } from '../../src/models/index.js';
import * as intakeService from '../../src/services/intake.service.js';

/**
 * Intake is exercised by calling `accept` directly with a built message, never
 * by waiting on a poller — the discipline Phase 4 established for the scheduler
 * and the reason this suite runs in seconds rather than minutes.
 */
export async function deliverEmail(email: SimulatedEmail): Promise<intakeService.IntakeOutcome> {
  const message = buildInboundEmail(email);
  return intakeService.accept(message, JSON.stringify({ ...email, attachments: undefined }));
}

export async function seedCustomerWithEmail(
  address: string,
  name = 'Known Customer',
): Promise<Customer> {
  const customer = await Customer.create({
    display_name: name,
    company: null,
    address: null,
    is_active: true,
    created_by_user_id: null,
  });

  await CustomerContact.create({
    customer_id: customer.id,
    kind: 'email',
    value_raw: address,
    value_normalised: normaliseContact('email', address),
    is_primary: true,
  });

  return customer;
}
