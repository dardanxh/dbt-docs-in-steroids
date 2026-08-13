class AppError(Exception):
    def __init__(self, detail: str, code: str):
        self.detail = detail
        self.code = code
        super().__init__(detail)


class NotFoundError(AppError):
    def __init__(self, detail: str = "Resource not found"):
        super().__init__(detail=detail, code="NOT_FOUND")


class BadRequestError(AppError):
    def __init__(self, detail: str = "Bad request"):
        super().__init__(detail=detail, code="BAD_REQUEST")


class ConflictError(AppError):
    def __init__(self, detail: str = "Conflict"):
        super().__init__(detail=detail, code="CONFLICT")
