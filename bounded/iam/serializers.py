from rest_framework import serializers
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from .models import User, Session, Role, Device, QRCode, IdempotencyKey


class UserSerializer(serializers.ModelSerializer):
    # Write-only: the stored column is `password_hash`, but callers send `password`.
    password = serializers.CharField(write_only=True, required=False, allow_blank=False,
                                     min_length=6, max_length=128,
                                     help_text="Plain text password; stored hashed.")
    site_id = serializers.CharField(write_only=True, required=False, allow_blank=True)
    site_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role_at_site = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['user_id', 'email', 'phone', 'full_name', 'role', 'status',
                  'last_login_at', 'created_at', 'password', 'site_id', 'site_code', 'role_at_site']
        read_only_fields = ['user_id', 'created_at', 'updated_at', 'last_login_at']

    def validate_password(self, value):
        if value.strip() != value or not value.strip():
            raise ValidationError("Password must not be blank.")
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        site_id = validated_data.pop('site_id', None)
        site_code = validated_data.pop('site_code', None)
        role_at_site = validated_data.pop('role_at_site', None)

        if not password:
            raise ValidationError({'password': "This field is required."})
        validated_data['password_hash'] = make_password(password)
        user = super().create(validated_data)

        # Create or update site assignment
        from bounded.network.models import Site, EmployeeSiteAssignment
        target_site = None
        if site_code:
            target_site = Site.objects.filter(code=site_code).first()
        elif site_id:
            target_site = Site.objects.filter(site_id=site_id).first()

        if target_site:
            mode = 'DARKHOUSE' if target_site.site_type == 'DS' else 'WAREHOUSE'
            role_name = role_at_site or ('STORE_MANAGER' if user.role == 'OPS_MANAGER' else 'OPERATOR')
            emp_code = user.email.split('@')[0].upper()[:20]
            EmployeeSiteAssignment.objects.create(
                user=user,
                site=target_site,
                employee=emp_code,
                mode=mode,
                role_at_site=role_name,
                is_primary=True,
                is_active=True
            )
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        site_id = validated_data.pop('site_id', None)
        site_code = validated_data.pop('site_code', None)
        role_at_site = validated_data.pop('role_at_site', None)

        if password:
            instance.password_hash = make_password(password)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update assignment if provided
        from bounded.network.models import Site, EmployeeSiteAssignment
        target_site = None
        if site_code:
            target_site = Site.objects.filter(code=site_code).first()
        elif site_id:
            target_site = Site.objects.filter(site_id=site_id).first()

        if target_site:
            mode = 'DARKHOUSE' if target_site.site_type == 'DS' else 'WAREHOUSE'
            role_name = role_at_site or ('STORE_MANAGER' if instance.role == 'OPS_MANAGER' else 'OPERATOR')
            emp_code = instance.email.split('@')[0].upper()[:20]
            asgn = EmployeeSiteAssignment.objects.filter(user=instance).first()
            if asgn:
                asgn.site = target_site
                asgn.mode = mode
                asgn.role_at_site = role_name
                asgn.save()
            else:
                EmployeeSiteAssignment.objects.create(
                    user=instance,
                    site=target_site,
                    employee=emp_code,
                    mode=mode,
                    role_at_site=role_name,
                    is_primary=True,
                    is_active=True
                )
        return instance

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Add primary assignment info.
        #
        # This used to be one query per row, which is 113 round trips to a
        # managed Postgres for one user list - measured at ~60s. The list
        # action prefetches the active assignments (UserViewSet.list); the
        # fallback keeps single-record responses correct.
        asgn = getattr(instance, 'active_assignments', None)
        if asgn is None:
            from bounded.network.models import EmployeeSiteAssignment
            asgn = (EmployeeSiteAssignment.objects
                    .filter(user=instance, is_active=True)
                    .select_related('site').first())
        else:
            asgn = asgn[0] if asgn else None
        if asgn and asgn.site:
            ret['assigned_site'] = {
                'code': asgn.site.code,
                'name': asgn.site.name,
                'site_type': asgn.site.site_type,
                'role_at_site': asgn.role_at_site,
            }
        else:
            ret['assigned_site'] = None
        return ret


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
