from rest_framework.pagination import PageNumberPagination


class ZippzoPageNumberPagination(PageNumberPagination):
    """PageNumberPagination that honours `?page_size=`.

    Stock a screen needs to see is not a fixed 50 rows: the guided workflows
    resolve scan targets out of the catalog and the network, and the old
    behaviour silently truncated `?page_size=500` at the default 50, so a scan
    could be rejected as "unknown" purely because the SKU or bin was on page 2.

    The default stays 50, so this only changes behaviour for callers that ask.
    """
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 1000
