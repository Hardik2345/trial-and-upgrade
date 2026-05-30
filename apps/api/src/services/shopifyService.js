const axios = require("axios");
const env = require("../config/env");

function shopifyClient(store) {
  if (!store.shopifyAccessToken) return null;
  return axios.create({
    baseURL: `https://${store.shopifyDomain}/admin/api/${env.shopifyApiVersion}/graphql.json`,
    headers: {
      "X-Shopify-Access-Token": store.shopifyAccessToken,
      "Content-Type": "application/json"
    },
    timeout: 15000
  });
}

async function graphql(store, query, variables = {}) {
  const client = shopifyClient(store);
  if (!client) return null;
  const response = await client.post("", { query, variables });
  if (response.data.errors) {
    const error = new Error(response.data.errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }
  return response.data.data;
}

function numericCustomerId(gid) {
  return String(gid || "").split("/").pop();
}

async function findCustomer(store, { email, phone }) {
  const queryText = email ? `email:${email}` : `phone:${phone}`;
  const data = await graphql(
    store,
    `query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        nodes { id email phone tags firstName lastName }
      }
    }`,
    { query: queryText }
  );
  const customer = data?.customers?.nodes?.[0];
  if (!customer) return null;
  return { ...customer, numericId: numericCustomerId(customer.id) };
}

async function createCustomer(store, { name, email, phone }) {
  const [firstName, ...rest] = String(name || "").trim().split(/\s+/);
  const data = await graphql(
    store,
    `mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id email phone tags firstName lastName }
        userErrors { field message }
      }
    }`,
    { input: { firstName, lastName: rest.join(" "), email, phone } }
  );
  const errors = data?.customerCreate?.userErrors || [];
  if (errors.length) {
    const error = new Error(errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }
  const customer = data?.customerCreate?.customer;
  return customer ? { ...customer, numericId: numericCustomerId(customer.id) } : null;
}

async function findOrCreateCustomer(store, details) {
  const primaryCustomer = details.email ? await findCustomer(store, { email: details.email }) : null;
  if (primaryCustomer) {
    return {
      primaryCustomer,
      eligibilityCustomer: primaryCustomer,
      created: false,
      phoneCollision: false
    };
  }

  try {
    const created = await createCustomer(store, details);
    return {
      primaryCustomer: created,
      eligibilityCustomer: created,
      created: true,
      phoneCollision: false
    };
  } catch (err) {
    if (/phone.*taken/i.test(err.message) && details.phone) {
      const phoneCustomer = await findCustomer(store, { phone: details.phone });
      if (phoneCustomer) {
        return {
          primaryCustomer: null,
          eligibilityCustomer: phoneCustomer,
          created: false,
          phoneCollision: true
        };
      }
    }
    throw err;
  }
}

async function addCustomerTags(store, customerGid, tags) {
  if (!customerGid || !tags?.length) return null;
  const data = await graphql(
    store,
    `mutation TagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`,
    { id: customerGid, tags }
  );
  const errors = data?.tagsAdd?.userErrors || [];
  if (errors.length) {
    const error = new Error(errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }
  return data?.tagsAdd?.node;
}

module.exports = { findCustomer, findOrCreateCustomer, addCustomerTags, numericCustomerId };
