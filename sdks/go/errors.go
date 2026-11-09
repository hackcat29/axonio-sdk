package axonio

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// ErrorCode identifies the category of an Axonio error.
type ErrorCode string

const (
	ErrorCodeAuth         ErrorCode = "AUTH_FAILED"
	ErrorCodeAccessDenied ErrorCode = "ACCESS_DENIED"
	ErrorCodeNotFound     ErrorCode = "NOT_FOUND"
	ErrorCodeRateLimit    ErrorCode = "RATE_LIMITED"
	ErrorCodeUnavailable  ErrorCode = "UNAVAILABLE"
	ErrorCodeTimeout      ErrorCode = "TIMEOUT"
	ErrorCodeValidation   ErrorCode = "INVALID_INPUT"
	ErrorCodeInternal     ErrorCode = "INTERNAL"
)

// Error is the error type every call returns.
type Error struct {
	Code       ErrorCode
	Message    string
	Details    interface{}
	RequestID  string
	RetryAfter int // milliseconds; non-zero for rate limit errors
	Status     int // HTTP status, when the error came from a response
}

// ClawDBError is the name this type had before the rename to Axonio.
type ClawDBError = Error

func (e *Error) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// IsNotFound returns true if this is a NOT_FOUND error.
func (e *Error) IsNotFound() bool { return e.Code == ErrorCodeNotFound }

// IsRateLimited returns true if this is a RATE_LIMITED error.
func (e *Error) IsRateLimited() bool { return e.Code == ErrorCodeRateLimit }

// IsRetriable returns true for transient errors.
func (e *Error) IsRetriable() bool {
	return e.Code == ErrorCodeUnavailable || e.Code == ErrorCodeRateLimit || e.Code == ErrorCodeTimeout
}

// errorFromHTTP maps an error response to an *Error, using the server's own
// message when it sent one.
func errorFromHTTP(status int, raw []byte, header http.Header) *Error {
	var body map[string]interface{}
	message := string(raw)
	if json.Unmarshal(raw, &body) == nil {
		if s, _ := body["error"].(string); s != "" {
			message = s
		} else if s, _ := body["message"].(string); s != "" {
			message = s
		}
		if detail, _ := body["detail"].(string); detail != "" {
			message += ": " + detail
		} else if req, _ := body["required"].(string); req != "" {
			message += ": requires " + req
		}
	}
	if message == "" {
		message = http.StatusText(status)
	}
	e := &Error{Message: message, Details: body, RequestID: header.Get("x-request-id"), Status: status}
	switch status {
	case http.StatusUnauthorized:
		e.Code = ErrorCodeAuth
	case http.StatusPaymentRequired, http.StatusForbidden:
		e.Code = ErrorCodeAccessDenied
	case http.StatusNotFound:
		e.Code = ErrorCodeNotFound
	case http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity:
		e.Code = ErrorCodeValidation
	case http.StatusTooManyRequests:
		e.Code = ErrorCodeRateLimit
		e.RetryAfter = 1000
		if secs, err := strconv.ParseFloat(header.Get("Retry-After"), 64); err == nil && secs >= 0 {
			e.RetryAfter = int(secs * 1000)
		}
	case http.StatusBadGateway, http.StatusServiceUnavailable:
		e.Code = ErrorCodeUnavailable
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		e.Code = ErrorCodeTimeout
	default:
		e.Code = ErrorCodeInternal
	}
	return e
}

// FromHTTPResponse maps an HTTP status code and body to an *Error.
func FromHTTPResponse(statusCode int, body string) *Error {
	return errorFromHTTP(statusCode, []byte(body), http.Header{})
}
