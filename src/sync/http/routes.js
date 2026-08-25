export const API_VERSION = 1;
export const API_ROOT = `/api/v${API_VERSION}`;

const segment = value => encodeURIComponent(String(value));

export const routes = Object.freeze({
  status: () => `${API_ROOT}/status`,
  device: () => `${API_ROOT}/device`,
  deviceProfile: () => `${API_ROOT}/device/profile`,
  channels: () => `${API_ROOT}/channels`,
  changes: channelId => `${API_ROOT}/channels/${segment(channelId)}/changes`,
  items: channelId => `${API_ROOT}/channels/${segment(channelId)}/items`,
  item: (channelId, itemId) => `${API_ROOT}/channels/${segment(channelId)}/items/${segment(itemId)}`,
  preview: (channelId, itemId, previewId) =>
    `${API_ROOT}/channels/${segment(channelId)}/items/${segment(itemId)}/previews/${segment(previewId)}`,
  content: (channelId, itemId, contentId) =>
    `${API_ROOT}/channels/${segment(channelId)}/items/${segment(itemId)}/contents/${segment(contentId)}`,
  contentRequests: (channelId, itemId, contentId) =>
    `${API_ROOT}/channels/${segment(channelId)}/items/${segment(itemId)}/contents/${segment(contentId)}/requests`,
  uploadPreview: (uploadId, previewId) =>
    `${API_ROOT}/uploads/${segment(uploadId)}/previews/${segment(previewId)}`,
  uploadContent: (uploadId, contentId) =>
    `${API_ROOT}/uploads/${segment(uploadId)}/contents/${segment(contentId)}`,
  completeUpload: uploadId => `${API_ROOT}/uploads/${segment(uploadId)}/complete`,
  transfers: () => `${API_ROOT}/transfers`,
  transfer: transferId => `${API_ROOT}/transfers/${segment(transferId)}`,
  work: () => `${API_ROOT}/work`,
  acceptWork: workId => `${API_ROOT}/work/${segment(workId)}/accept`,
  rejectWork: workId => `${API_ROOT}/work/${segment(workId)}/reject`,
});
