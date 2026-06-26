import type { AuthUser, ParkInfo } from '../types';
import type {
    CreateManagedUserInput,
    ManagedUserAccount,
    SignupRequestRecord,
    UpdateManagedUserInput,
} from './pocketbaseService';
import {
    approveSignupRequest,
    changeOwnPassword,
    createManagedUser,
    deleteManagedUser,
    deleteSignupRequest,
    fetchManagedUsers,
    fetchPublicParks,
    fetchSignupRequests,
    rejectSignupRequest,
    submitSignupRequest,
    updateManagedUser,
    updateManagedUserEnabled,
} from './pocketbaseService';

export type {
    CreateManagedUserInput,
    ManagedUserAccount,
    SignupRequestRecord,
    UpdateManagedUserInput,
} from './pocketbaseService';

export const changeOwnCloudPassword = async (
    oldPassword: string,
    newPassword: string,
): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    return changeOwnPassword(oldPassword, newPassword);
};

export const fetchManagedCloudUsers = async (): Promise<{
    success: boolean;
    users: ManagedUserAccount[];
    message: string;
}> => {
    return fetchManagedUsers();
};

export const fetchPublicCloudParks = async (): Promise<{
    success: boolean;
    parks: ParkInfo[];
    message: string;
}> => {
    return fetchPublicParks();
};

export const submitCloudSignupRequest = async (
    email: string,
    password: string,
    requestedProjectIds: string[],
    applicantName: string,
): Promise<{ success: boolean; message: string }> => {
    return submitSignupRequest(email, password, requestedProjectIds, applicantName);
};

export const fetchCloudSignupRequests = async (): Promise<{
    success: boolean;
    requests: SignupRequestRecord[];
    message: string;
}> => {
    return fetchSignupRequests();
};

export const approveCloudSignupRequest = async (
    requestId: string,
    reviewerNote: string = '',
): Promise<{ success: boolean; message: string }> => {
    return approveSignupRequest(requestId, reviewerNote);
};

export const rejectCloudSignupRequest = async (
    requestId: string,
    reviewerNote: string = '',
): Promise<{ success: boolean; message: string }> => {
    return rejectSignupRequest(requestId, reviewerNote);
};

export const createManagedCloudUser = async (
    input: CreateManagedUserInput,
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    return createManagedUser(input);
};

export const updateManagedCloudUserEnabled = async (
    userId: string,
    enabled: boolean,
): Promise<{ success: boolean; message: string }> => {
    return updateManagedUserEnabled(userId, enabled);
};

export const updateManagedCloudUser = async (
    input: UpdateManagedUserInput,
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    return updateManagedUser(input);
};

export const deleteManagedCloudUser = async (
    userId: string,
    currentAuthUserId?: string,
): Promise<{ success: boolean; message: string; cleanedSignupCount?: number }> => {
    return deleteManagedUser(userId, currentAuthUserId);
};

export const deleteCloudSignupRequest = async (
    requestId: string,
): Promise<{ success: boolean; message: string }> => {
    return deleteSignupRequest(requestId);
};
