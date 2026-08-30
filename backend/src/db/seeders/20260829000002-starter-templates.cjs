'use strict';

/**
 * A small starter set for the quick-reply library (Phase 4).
 *
 * One of these is DELIBERATELY ENGLISH-ONLY. FR-070 requires a single-language
 * template to be offered with its language identified rather than silently
 * substituted, and a rule with no fixture is a rule nobody exercises. This
 * gives that path a case from the first run.
 *
 * Idempotent by title: re-running inserts only what is missing, so a seeded
 * environment can be re-seeded without duplicating the library.
 *
 * @type {import('sequelize-cli').Migration}
 */
const TEMPLATES = [
  {
    title_en: 'Acknowledgement',
    title_ar: 'إشعار باستلام الطلب',
    body_en:
      'Thank you for getting in touch. We have your request and are looking into it now. ' +
      'We will come back to you as soon as we have something concrete.',
    body_ar:
      'شكرًا لتواصلك معنا. لقد استلمنا طلبك ونعمل على دراسته الآن، ' +
      'وسنعود إليك فور توفّر أي مستجدات.',
  },
  {
    title_en: 'Waiting on the customer',
    title_ar: 'بانتظار ردّ العميل',
    body_en:
      'We need a little more information before we can continue. Could you confirm the details ' +
      'below? We will pick this straight back up once we hear from you.',
    body_ar:
      'نحتاج إلى بعض المعلومات الإضافية قبل أن نتمكن من المتابعة. هل يمكنك تأكيد التفاصيل ' +
      'أدناه؟ سنستكمل العمل فور ورود ردّك.',
  },
  {
    title_en: 'Resolved — closing summary',
    title_ar: 'تم الحل — ملخّص الإغلاق',
    body_en:
      'This is now resolved. A short summary of what was done is below. ' +
      'If anything still looks wrong, reply here and we will reopen it.',
    body_ar:
      'تم حلّ المشكلة. تجد أدناه ملخّصًا موجزًا لما تم تنفيذه. ' +
      'وإذا لاحظت أي خلل، فقط ردّ على هذه الرسالة وسنعيد فتح الطلب.',
  },
  {
    // DELIBERATELY ENGLISH-ONLY — see the file comment. Do not "fix" this by
    // adding an Arabic version; add a fourth template instead.
    title_en: 'Escalated to a specialist',
    title_ar: null,
    body_en:
      'I have passed this to a specialist who handles this area. They have the full history of ' +
      'the ticket, so there is no need to repeat anything.',
    body_ar: null,
  },
];

module.exports = {
  async up(queryInterface) {
    const [admins] = await queryInterface.sequelize.query(
      "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.`key` = 'admin' " +
        'ORDER BY u.id LIMIT 1',
    );

    if (admins.length === 0) {
      console.log('No administrator account found; skipping starter templates.');
      return;
    }

    const [existing] = await queryInterface.sequelize.query('SELECT title_en FROM reply_templates');
    const held = new Set(existing.map((row) => row.title_en));
    const now = new Date();

    const rows = TEMPLATES.filter((template) => !held.has(template.title_en)).map((template) => ({
      ...template,
      retired_at: null,
      created_by_user_id: admins[0].id,
      created_at: now,
      updated_at: now,
    }));

    if (rows.length === 0) {
      console.log('Starter templates already present; nothing to do.');
      return;
    }

    await queryInterface.bulkInsert('reply_templates', rows);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('reply_templates', {
      title_en: TEMPLATES.map((template) => template.title_en),
    });
  },
};
