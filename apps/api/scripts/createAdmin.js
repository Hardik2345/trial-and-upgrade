const bcrypt = require("bcrypt");
const { connectDatabase } = require("../src/config/db");
const AdminUser = require("../src/models/AdminUser");

async function main() {
  const [email, password, name = "Admin", role = "super_admin"] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run create-admin --workspace apps/api -- <email> <password> ["Name"] [role]');
    process.exit(1);
  }
  await connectDatabase();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await AdminUser.findOneAndUpdate(
    { email: email.toLowerCase() },
    { email: email.toLowerCase(), name, passwordHash, role, active: true },
    { upsert: true, new: true }
  );
  console.log(`Admin ready: ${user.email} (${user.role})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
