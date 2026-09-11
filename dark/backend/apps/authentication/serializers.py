from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, UserRole, ApprovalRequest

class UserRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserRole
        fields = ['id', 'role']

class UserSerializer(serializers.ModelSerializer):
    roles = serializers.SlugRelatedField(many=True, read_only=True, slug_field='role')
    approval_status = serializers.CharField(source='profile.approval_status', read_only=True)
    is_approved_by_admin = serializers.BooleanField(source='profile.is_approved_by_admin', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'roles', 'approval_status', 'is_approved_by_admin']

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    phone = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'phone']

    def create(self, validated_data):
        phone = validated_data.pop('phone', '')
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            is_active=False  # Gated until admin approval
        )
        UserProfile.objects.create(
            user=user,
            phone=phone,
            is_approved_by_admin=False,
            approval_status='pending'
        )
        ApprovalRequest.objects.create(user=user)
        return user

class ApproveUserSerializer(serializers.Serializer):
    department = serializers.ChoiceField(choices=[
        ('admin', 'Admin'),
        ('management', 'Management'),
        ('receiving', 'Receiving'),
        ('picking', 'Picking'),
        ('packing', 'Packing'),
        ('shipping', 'Shipping'),
        ('qc', 'QC Inspection'),
        ('inventory_control', 'Inventory Control'),
    ])
    roles = serializers.ListField(
        child=serializers.CharField(),
        allow_empty=False
    )
    shift_start = serializers.TimeField(required=False, default="08:00:00")
    shift_end = serializers.TimeField(required=False, default="17:00:00")
    forklift_certified = serializers.BooleanField(required=False, default=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    warehouse = serializers.UUIDField(required=False, allow_null=True, help_text='Warehouse ID to assign employee to')

class ApprovalRequestSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ApprovalRequest
        fields = ['id', 'user', 'requested_at', 'approved_at', 'notes']


class LoginApprovalRequestSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    approved_by_username = serializers.CharField(source='approved_by.username', read_only=True)

    class Meta:
        from .models import LoginApprovalRequest
        model = LoginApprovalRequest
        fields = [
            'id', 'user', 'otp_code', 'status', 'ip_address',
            'device_info', 'requested_at', 'approved_by_username',
            'approved_at', 'expires_at'
        ]
