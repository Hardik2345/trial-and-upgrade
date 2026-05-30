const FunnelEvent = require("../models/FunnelEvent");

let ioInstance = null;

function setSocketServer(io) {
  ioInstance = io;
}

async function recordFunnelEvent({ store, campaign, participant, eventType, metadata = {} }) {
  const event = await FunnelEvent.create({
    tenantStoreId: store._id,
    campaignId: campaign._id,
    participantId: participant?._id,
    eventType,
    name: participant?.name || metadata.name || "",
    mobile: participant?.phoneDisplay || participant?.phoneMasked || metadata.mobile || "",
    phoneHash: participant?.phoneHash || metadata.phoneHash || "",
    email: participant?.email || metadata.email || "",
    rewardLabel: participant?.reward?.label || metadata.rewardLabel,
    metadata,
    occurredAt: new Date()
  });

  if (ioInstance) {
    ioInstance.to(`store:${store._id}`).emit("funnelEventUpdate", {
      storeId: String(store._id),
      campaignId: String(campaign._id),
      eventType
    });
  }
  return event;
}

module.exports = { setSocketServer, recordFunnelEvent };
