"""Loguru setup shared by the whole backend."""

from __future__ import annotations

import logging
import sys

from loguru import logger

_FORMAT = (
    "<green>{time:HH:mm:ss.SSS}</green> "
    "<level>{level: <7}</level> "
    "<cyan>{name}</cyan>:<cyan>{line}</cyan> "
    "<level>{message}</level>"
)


class _InterceptHandler(logging.Handler):
    """Route stdlib logging (uvicorn, chromadb, ...) through loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        logger.opt(depth=6, exception=record.exc_info).log(level, record.getMessage())


def setup_logger(level: str = "INFO"):
    logger.remove()
    logger.add(sys.stderr, level=level, format=_FORMAT, colorize=True, backtrace=False)
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for noisy in ("httpx", "httpx2", "chromadb", "sentence_transformers", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logger


__all__ = ["logger", "setup_logger"]
