import { http, requestBlob } from './http';

export interface CustomerAttachment {
  id: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: { id: number; fullName: string };
  createdAt: string;
}

export async function list(customerId: number): Promise<{ items: CustomerAttachment[] }> {
  return http.get<{ items: CustomerAttachment[] }>(`/customers/${customerId}/attachments`);
}

export async function upload(customerId: number, file: File): Promise<CustomerAttachment> {
  const form = new FormData();
  form.append('file', file);

  return http.postForm<CustomerAttachment>(`/customers/${customerId}/attachments`, form);
}

/**
 * Downloads through the authenticated endpoint, never a direct path into
 * storage — the directory is not served, and a plain link would arrive without
 * the Authorization header (FR-033).
 */
export async function download(customerId: number, attachment: CustomerAttachment): Promise<void> {
  const blob = await requestBlob(`/customers/${customerId}/attachments/${attachment.id}/download`);
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.originalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function remove(customerId: number, attachmentId: number): Promise<void> {
  await http.delete<void>(`/customers/${customerId}/attachments/${attachmentId}`);
}
