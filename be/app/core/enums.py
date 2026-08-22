from enum import StrEnum


class Layer(StrEnum):
    """A dbt project layer, derived from a node's fqn / file path. `source` is
    for raw sources, `other` is the fallback for models we can't classify."""

    STAGE = "stage"
    DWH = "dwh"
    DATAMART = "datamart"
    REPORTING = "reporting"
    LKP = "lkp"
    ARCHIVE = "archive"
    SOURCE = "source"
    OTHER = "other"


class ResourceType(StrEnum):
    MODEL = "model"
    SEED = "seed"
    SOURCE = "source"


class SourceType(StrEnum):
    """How a project's artifacts are supplied."""

    PATH = "path"  # read target/manifest.json + catalog.json from a local dir
    UPLOAD = "upload"  # artifacts uploaded via the UI


class IngestStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


class TransformType(StrEnum):
    """How an output column is derived from its upstream column(s)."""

    DIRECT = "direct"  # bare passthrough of one column
    DERIVED = "derived"  # expression over one or more columns
    AGGREGATE = "aggregate"  # inside an aggregate function
    UNKNOWN = "unknown"  # could not classify


class Confidence(StrEnum):
    HIGH = "high"
    LOW = "low"  # produced by a parse fallback


class ParseStatus(StrEnum):
    OK = "ok"
    PARTIAL = "partial"
    FAILED = "failed"


class ErrorCategory(StrEnum):
    """Classification of a dbt operational failure, assigned by the uploading
    agent. Kept fixed so coloring/analytics stay consistent."""

    TEST_FAILURE = "test_failure"  # a dbt test assertion failed
    COMPILATION_ERROR = "compilation_error"  # jinja/sql compile: ref/source/macro/var/syntax
    SQL_RUNTIME_ERROR = "sql_runtime_error"  # warehouse execution error at runtime
    FRESHNESS_ERROR = "freshness_error"  # source freshness check failed / stale source
    UPSTREAM_FAILURE = "upstream_failure"  # skipped/failed due to an upstream model failing
    PERMISSION_ERROR = "permission_error"  # auth / insufficient privileges / access denied
    RESOURCE_LIMIT = "resource_limit"  # timeout, OOM, quota/slot exceeded, warehouse suspended
    DEPENDENCY_MISSING = "dependency_missing"  # relation/column not found, schema drift
    CONNECTION_ERROR = "connection_error"  # warehouse/network/infra connection failure
    CONFIGURATION_ERROR = "configuration_error"  # bad config, missing target/profile, invalid materialization
    OTHER = "other"  # uncategorized
