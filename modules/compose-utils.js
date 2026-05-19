export async function getIdentityIdForTab(tabId) {
  try {
    const details = await messenger.compose.getComposeDetails(tabId);
    return details.identityId || null;
  } catch (err) {
    console.warn("TemplateWing: could not get current identity", err);
    return null;
  }
}
