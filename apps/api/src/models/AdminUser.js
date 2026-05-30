const mongoose = require("mongoose");

const AdminUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["super_admin", "store_admin"], default: "store_admin" },
    tenantStoreIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "TenantStore" }],
    active: { type: Boolean, default: true },
    lastLoginAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminUser", AdminUserSchema);
