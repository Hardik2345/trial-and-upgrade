function parsePagination(query, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit || defaultLimit)));
  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

function paginationMeta({ total, page, limit }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    total,
    page,
    limit,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages
  };
}

module.exports = { parsePagination, paginationMeta };
