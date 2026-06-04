const mongoose = require("mongoose");

const NewUserSchema = new mongoose.Schema(
  {
    tenantStoreId: { type: mongoose.Schema.Types.ObjectId, ref: "TenantStore", required: true, index: true },
    publicId: { type: String, required: true, unique: true },
    phoneNormalized: { type: String, required: true },
    phoneDisplay: { type: String, required: true }
  },
  { timestamps: true }
);

NewUserSchema.index({ tenantStoreId: 1, phoneNormalized: 1 }, { unique: true });

module.exports = mongoose.model("NewUser", NewUserSchema, "new_users");
