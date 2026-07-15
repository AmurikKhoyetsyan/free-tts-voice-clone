"""Image Video Editor — route aggregator.

Mounts all sub-routers under the ``/api/imgvid`` prefix.
Business logic lives in the service package (``routers/imgvid/``);
individual route groups live in ``routers/imgvid/routes/``.
"""

from fastapi import APIRouter

from routers.imgvid.routes import export, media, project_files, projects, templates

router = APIRouter(prefix="/api/imgvid", tags=["imgvid"])

router.include_router(media.router)
router.include_router(projects.router)
router.include_router(templates.router)
router.include_router(project_files.router)
router.include_router(export.router)
