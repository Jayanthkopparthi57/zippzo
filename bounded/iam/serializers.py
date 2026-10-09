from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from .models import User, Session, Role, Device, QRCode, IdempotencyKey


class UserSerializer(serializers.ModelSerializer):
    # Write-only: the stored column is `password_hash`, but callers send `password`.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False,
                                     min_length=6, max_length=128,
                                     help_text="Plain text password; stored hashed.")

    class Meta:
        model = User
        fields = ['user_id', 'email', 'phone', 'full_name', 'role', 'status',
                  'last_login_at', 'created_at', 'password']
        read_only_fields = ['user_id', 'created_at', 'updated_at', 'last_login_at']

    def validate_password(self, value):
        if value.strip() != value or not value.strip():
            raise ValidationError("Password must not be blank.")
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if not password:
            raise ValidationError({'password': "This field is required."})
        validated_data['password_hash'] = make_password(password)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        if password:
            instance.password_hash = make_password(password)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance

    def to_representation(self, instance):
        # Never echo the credential back out.
        return super().to_representation(instance)


class SessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Session
        fields = ['session_id', 'user', 'token', 'device_fingerprint', 'ip_address', 'is_active', 'expires_at', 'created_at']
        read_only_fields = ['session_id', 'created_at']


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['role_id', 'name', 'description', 'permissions', 'is_system', 'created_at']
        read_only_fields = ['role_id', 'created_at']


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = ['device_id', 'user', 'platform', 'push_token', 'is_active', 'last_seen_at', 'created_at']
        read_only_fields = ['device_id', 'created_at']


class QRCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = QRCode
        fields = ['qr_id', 'code', 'data', 'qr_type', 'expires_at', 'scan_count', 'created_at']
        read_only_fields = ['qr_id', 'created_at']


class IdempotencyKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = IdempotencyKey
        fields = ['key', 'action', 'user_id', 'response_json', 'expires_at', 'created_at']
        read_only_fields = ['key', 'created_at']
