from rest_framework import serializers
from .models import User, ReasonCode


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = '__all__'


class ReasonCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReasonCode
        fields = '__all__'
