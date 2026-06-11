export function listResponse<T>(data: T[], page: number, pageSize: number, totalItems: number) {
  return {
    data,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize)
    }
  };
}

export function savedResponse(id: string, createdAt = new Date()) {
  return {
    id,
    status: "SAVED",
    createdAt: createdAt.toISOString()
  };
}
