from django.urls import path

from .exports import ExportView

urlpatterns = [
    path('', ExportView.as_view(), name='export'),
]
