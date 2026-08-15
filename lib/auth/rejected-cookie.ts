/**
 * Short-lived cookie carrying the email a hook-rejected sign-in attempted,
 * so the rejected-domain screen can show it (per the design) without ever
 * putting an email in a URL parameter.
 */
export const REJECTED_EMAIL_COOKIE = "elr_rejected_email";
