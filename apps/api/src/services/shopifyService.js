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

function normalizeTagList(tags) {
  return (tags || []).map((tag) => String(tag).trim()).filter(Boolean);
}

function customerHasAnyTag(customer, tags) {
  const normalizedTags = normalizeTagList(tags).map((tag) => tag.toLowerCase());
  if (!normalizedTags.length) return false;
  const customerTags = normalizeTagList(customer?.tags).map((tag) => tag.toLowerCase());
  return normalizedTags.some((tag) => customerTags.includes(tag));
}

async function findCustomer(store, { email, phone }) {
  const queryText = email ? `email:${email}` : `phone:${phone}`;
  console.log("[shopify] customer lookup", {
    store: store?.slug,
    queryType: email ? "email" : "phone",
    email: email || null,
    phone: phone || null
  });
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
  console.log("[shopify] customer lookup result", {
    store: store?.slug,
    found: Boolean(customer),
    customerId: customer ? numericCustomerId(customer.id) : null
  });
  if (!customer) return null;
  return { ...customer, numericId: numericCustomerId(customer.id) };
}

async function findCustomers(store, { email, phone, limit = 10 }) {
  const queryText = email ? `email:${email}` : `phone:${phone}`;
  console.log("[shopify] customer lookup", {
    store: store?.slug,
    queryType: email ? "email" : "phone",
    email: email || null,
    phone: phone || null
  });
  const data = await graphql(
    store,
    `query FindCustomers($query: String!, $limit: Int!) {
      customers(first: $limit, query: $query) {
        nodes { id email phone tags firstName lastName }
      }
    }`,
    { query: queryText, limit }
  );
  const customers = (data?.customers?.nodes || []).map((customer) => ({
    ...customer,
    numericId: numericCustomerId(customer.id)
  }));
  console.log("[shopify] customer lookup result", {
    store: store?.slug,
    found: customers.length > 0,
    count: customers.length,
    customerIds: customers.map((customer) => customer.numericId)
  });
  return customers;
}

async function getCustomerByGid(store, customerGid) {
  if (!customerGid) return null;
  const data = await graphql(
    store,
    `query GetCustomer($id: ID!) {
      customer(id: $id) {
        id email phone tags firstName lastName
      }
    }`,
    { id: customerGid }
  );
  const customer = data?.customer;
  if (!customer) return null;
  return { ...customer, numericId: numericCustomerId(customer.id) };
}

async function resolveUserLookupCustomer(store, { phone, email, flitsEligibleTags = [] }) {
  const candidates = await findCustomers(store, { phone, limit: 20 });
  if (!candidates.length) return null;

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const emailMatches = normalizedEmail
    ? candidates.filter((customer) => String(customer.email || "").trim().toLowerCase() === normalizedEmail)
    : [];
  const taggedEmailMatch = emailMatches.find((customer) => customerHasAnyTag(customer, flitsEligibleTags));
  if (taggedEmailMatch) {
    console.log("[shopify] customer present", {
      store: store?.slug,
      match: "phone+email+flits-tags",
      customerId: taggedEmailMatch.numericId
    });
    return taggedEmailMatch;
  }

  if (emailMatches.length === 1) {
    console.log("[shopify] customer present", {
      store: store?.slug,
      match: "phone+email",
      customerId: emailMatches[0].numericId
    });
    return emailMatches[0];
  }

  const taggedCandidate = candidates.find((customer) => customerHasAnyTag(customer, flitsEligibleTags));
  if (taggedCandidate) {
    console.log("[shopify] customer present", {
      store: store?.slug,
      match: "phone+flits-tags",
      customerId: taggedCandidate.numericId
    });
    return taggedCandidate;
  }

  if (emailMatches.length) {
    console.log("[shopify] customer present", {
      store: store?.slug,
      match: "phone+email-fallback",
      customerId: emailMatches[0].numericId
    });
    return emailMatches[0];
  }

  console.log("[shopify] customer present", {
    store: store?.slug,
    match: "phone",
    customerId: candidates[0].numericId
  });
  return candidates[0];
}

async function createCustomer(store, { name, email, phone }) {
  const [firstName, ...rest] = String(name || "").trim().split(/\s+/);
  console.log("[shopify] customer create request", {
    store: store?.slug,
    email: email || null,
    phone: phone || null,
    name: name || null
  });
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
    console.log("[shopify] customer create failed", {
      store: store?.slug,
      errors: errors.map((item) => item.message)
    });
    const error = new Error(errors.map((item) => item.message).join(", "));
    error.status = 502;
    throw error;
  }
  const customer = data?.customerCreate?.customer;
  console.log("[shopify] customer create result", {
    store: store?.slug,
    created: Boolean(customer),
    customerId: customer ? numericCustomerId(customer.id) : null
  });
  return customer ? { ...customer, numericId: numericCustomerId(customer.id) } : null;
}

async function findOrCreateCustomer(store, details) {
  const primaryCustomer = details.email ? await findCustomer(store, { email: details.email }) : null;
  if (primaryCustomer) {
    console.log("[shopify] customer present", {
      store: store?.slug,
      match: "email",
      customerId: primaryCustomer.numericId
    });
    return {
      primaryCustomer,
      eligibilityCustomer: primaryCustomer,
      created: false,
      phoneCollision: false
    };
  }

  try {
    const created = await createCustomer(store, details);
    console.log("[shopify] customer created", {
      store: store?.slug,
      customerId: created?.numericId || null
    });
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
        console.log("[shopify] customer present", {
          store: store?.slug,
          match: "phone",
          customerId: phoneCustomer.numericId
        });
        return {
          primaryCustomer: null,
          eligibilityCustomer: phoneCustomer,
          created: false,
          phoneCollision: true
        };
      }
    }
    console.log("[shopify] customer create error", {
      store: store?.slug,
      message: err?.message || "unknown"
    });
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

module.exports = { findCustomer, findCustomers, getCustomerByGid, resolveUserLookupCustomer, findOrCreateCustomer, addCustomerTags, numericCustomerId };
